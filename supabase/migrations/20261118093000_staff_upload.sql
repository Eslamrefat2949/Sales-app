-- Admins keep the sales people of each branch up to date by uploading a staff sheet.
-- A link between an employee and a branch is switched off rather than removed, so history stays.
alter table public.employee_branches
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

-- Staff lists only follow active links.
create or replace function public.app_bootstrap()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_account public.accounts%rowtype;
  v_branch public.branches%rowtype;
begin
  select * into v_account from public.accounts where user_id = auth.uid() and is_active;
  if not found then
    raise exception 'NO_ACCOUNT' using errcode = '42501';
  end if;
  if v_account.branch_id is not null then
    select * into v_branch from public.branches where id = v_account.branch_id;
  end if;

  return jsonb_build_object(
    'account', jsonb_build_object('id', v_account.id, 'kind', v_account.kind, 'label', v_account.display_name),
    'branch', case when v_branch.id is null then null else jsonb_build_object(
      'id', v_branch.id, 'code', v_branch.code, 'pos_name', v_branch.pos_name) end,
    'default_discount_percent', coalesce(
      (select (value #>> '{}')::numeric from public.app_settings where key = 'default_discount_percent'), 30),
    'offer', (
      select jsonb_build_object('id', o.id, 'code', o.code, 'name', o.name, 'buy_qty', o.buy_qty, 'pay_qty', o.pay_qty)
      from public.offers o
      where o.is_active
        and (o.starts_on is null or o.starts_on <= (now() at time zone 'Africa/Cairo')::date)
        and (o.ends_on is null or o.ends_on >= (now() at time zone 'Africa/Cairo')::date)
      order by o.updated_at desc
      limit 1),
    'payment_methods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'name_ar', m.name_ar, 'kind', m.kind, 'journal', bpm.journal)
        order by bpm.sort_order, m.name)
      from public.branch_payment_methods bpm
      join public.payment_methods m on m.id = bpm.method_id
      where bpm.branch_id = v_branch.id and bpm.is_active and m.is_active), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.odoo_name, 'in_branch', true) order by e.odoo_name)
      from public.employees e
      where e.is_active
        and (v_branch.id is null or exists (
          select 1 from public.employee_branches eb
          where eb.employee_id = e.id and eb.branch_id = v_branch.id and eb.is_active))), '[]'::jsonb),
    'catalog_version', (select coalesce(max(updated_at), 'epoch'::timestamptz) from public.products)
  );
end;
$$;

alter policy "read own branch staff or all as admin" on public.employees
  using (
    (select private.is_admin())
    or exists (
      select 1 from public.employee_branches eb
      where eb.employee_id = employees.id and eb.branch_id = (select private.current_branch_id()) and eb.is_active)
    or exists (
      select 1 from public.invoices i
      where i.sales_person_id = employees.id and i.branch_id = (select private.current_branch_id()))
  );

/**
 * Applies a staff sheet. p_rows: [{ "name": "9756-EZZ ELDIN EHAB IBRAHIM", "branch": "OCT", "active": true }].
 * For every employee named in the sheet, the branches on its active rows become its branches and any
 * other branch link is switched off; an employee whose rows are all inactive is marked as left.
 * Employees not in the sheet are not touched.
 */
create or replace function public.admin_upsert_staff(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_unknown text[];
  v_added integer;
  v_left integer;
  v_links integer;
begin
  if not private.is_admin() then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'EMPTY_SHEET' using errcode = '22023';
  end if;

  create temporary table pg_temp.staff_rows on commit drop as
  select upper(regexp_replace(trim(r ->> 'name'), '\s+', ' ', 'g')) as name,
         upper(trim(r ->> 'branch')) as branch_code,
         coalesce((r ->> 'active')::boolean, true) as active
  from jsonb_array_elements(p_rows) r
  where coalesce(trim(r ->> 'name'), '') <> '';

  select array_agg(distinct s.branch_code order by s.branch_code) into v_unknown
  from pg_temp.staff_rows s
  where s.active and not exists (select 1 from public.branches b where b.code = s.branch_code);
  if v_unknown is not null then
    raise exception 'UNKNOWN_BRANCH %', array_to_string(v_unknown, ', ') using errcode = '22023';
  end if;

  with names as (select distinct name from pg_temp.staff_rows),
  inserted as (
    insert into public.employees (odoo_name)
    select n.name from names n
    where not exists (select 1 from public.employees e where upper(e.odoo_name) = n.name)
    returning 1)
  select count(*) into v_added from inserted;

  -- Active rows: switch the link on (or create it), and make sure the employee is active.
  insert into public.employee_branches (employee_id, branch_id, is_active, updated_at)
  select distinct e.id, b.id, true, now()
  from pg_temp.staff_rows s
  join public.employees e on upper(e.odoo_name) = s.name
  join public.branches b on b.code = s.branch_code
  where s.active
  on conflict (employee_id, branch_id) do update set is_active = true, updated_at = now()
  where public.employee_branches.is_active = false;
  get diagnostics v_links = row_count;

  update public.employees e set is_active = true, updated_at = now()
  where not e.is_active and exists (select 1 from pg_temp.staff_rows s where s.name = upper(e.odoo_name) and s.active);

  -- Any other branch of an employee in the sheet is switched off.
  update public.employee_branches eb set is_active = false, updated_at = now()
  from public.employees e
  where eb.employee_id = e.id and eb.is_active
    and exists (select 1 from pg_temp.staff_rows s where s.name = upper(e.odoo_name))
    and not exists (
      select 1 from pg_temp.staff_rows s join public.branches b on b.code = s.branch_code
      where s.name = upper(e.odoo_name) and s.active and b.id = eb.branch_id);

  -- Employees whose rows are all inactive have left.
  with gone as (
    update public.employees e set is_active = false, updated_at = now()
    where e.is_active
      and exists (select 1 from pg_temp.staff_rows s where s.name = upper(e.odoo_name))
      and not exists (select 1 from pg_temp.staff_rows s where s.name = upper(e.odoo_name) and s.active)
    returning 1)
  select count(*) into v_left from gone;

  insert into public.audit_log (actor, action, entity, details)
  values (auth.uid(), 'staff_upload', 'employees',
          jsonb_build_object('rows', jsonb_array_length(p_rows), 'added', v_added, 'left', v_left));

  return jsonb_build_object(
    'added', v_added,
    'left', v_left,
    'links_turned_on', v_links,
    'active_employees', (select count(*) from public.employees where is_active));
end;
$$;

revoke execute on function public.admin_upsert_staff(jsonb) from public, anon;
grant execute on function public.admin_upsert_staff(jsonb) to authenticated;
