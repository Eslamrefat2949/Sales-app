-- A branch only receives its own sales people; admins still receive everyone.
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
          select 1 from public.employee_branches eb where eb.employee_id = e.id and eb.branch_id = v_branch.id))), '[]'::jsonb),
    'catalog_version', (select coalesce(max(updated_at), 'epoch'::timestamptz) from public.products)
  );
end;
$$;
