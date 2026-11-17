-- PIN policy for go-live:
--  * PINs are 4 to 6 digits.
--  * Branches start on the default PIN 1234 and must choose their own PIN at their first sign-in.
--  * Every account can change its own PIN later (current PIN required, wrong tries count to the lock).
--  * Admins can set a PIN or reset an account back to the default (which forces a change again).
-- Plus single sales person changes for admins (add to a branch / remove from a branch).

alter table public.accounts add column if not exists must_change_pin boolean not null default false;

create or replace function private.set_account_pin(p_account_id uuid, p_pin text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_account public.accounts%rowtype;
  v_user_id uuid;
  v_email text;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN_FORMAT' using errcode = '22023', hint = 'The PIN must be 4 to 6 digits.';
  end if;
  select * into v_account from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'UNKNOWN_ACCOUNT' using errcode = 'P0002';
  end if;

  if v_account.user_id is null then
    v_user_id := gen_random_uuid();
    v_email := 'acct-' || replace(gen_random_uuid()::text, '-', '') || '@ravin-sales.invalid';
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email,
      extensions.crypt(p_pin, extensions.gen_salt('bf')), now(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      jsonb_build_object('account_id', p_account_id), now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (user_id, provider_id, identity_data, provider, created_at, updated_at)
    values (
      v_user_id, v_user_id::text,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
      'email', now(), now()
    );
    update public.accounts set user_id = v_user_id where id = p_account_id;
  else
    update auth.users
    set encrypted_password = extensions.crypt(p_pin, extensions.gen_salt('bf')), updated_at = now()
    where id = v_account.user_id;
    -- A new PIN signs out every phone of the account.
    update auth.sessions set not_after = now()
    where user_id = v_account.user_id and (not_after is null or not_after > now());
  end if;

  update public.accounts set pin_changed_at = now() where id = p_account_id;
end;
$$;

/** Easy PINs a branch may not choose: the default, one digit repeated, or a straight run (1234, 9876). */
create or replace function private.is_weak_pin(p_pin text)
returns boolean
language sql immutable set search_path = '' as $$
  select p_pin = '1234'
      or p_pin ~ '^(.)\1+$'
      or position(p_pin in '01234567890') > 0
      or position(p_pin in '09876543210') > 0;
$$;

create or replace function public.verify_pin(p_account_id uuid, p_pin text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid;
  v_hash text;
  v_email text;
  v_last_success timestamptz;
  v_pin_changed timestamptz;
  v_failures integer;
begin
  select a.user_id, a.pin_changed_at into v_user_id, v_pin_changed
  from public.accounts a where a.id = p_account_id and a.is_active;
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'UNKNOWN_ACCOUNT');
  end if;

  select max(attempted_at) into v_last_success
  from public.login_attempts where account_id = p_account_id and succeeded;
  select count(*) into v_failures
  from public.login_attempts
  where account_id = p_account_id and not succeeded
    and attempted_at > now() - interval '15 minutes'
    and attempted_at > greatest(coalesce(v_last_success, '-infinity'::timestamptz),
                                coalesce(v_pin_changed, '-infinity'::timestamptz));
  if v_failures >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'LOCKED');
  end if;

  select u.encrypted_password, u.email into v_hash, v_email from auth.users u where u.id = v_user_id;
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' or v_hash is null or extensions.crypt(p_pin, v_hash) <> v_hash then
    insert into public.login_attempts (account_id, succeeded) values (p_account_id, false);
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PIN', 'attempts_left', greatest(0, 4 - v_failures));
  end if;

  insert into public.login_attempts (account_id, succeeded) values (p_account_id, true);
  return jsonb_build_object('ok', true, 'email', v_email);
end;
$$;

-- An admin sets a PIN the account keeps (no forced change).
create or replace function public.admin_set_pin(p_account_id uuid, p_pin text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
  perform private.set_account_pin(p_account_id, p_pin);
  update public.accounts set must_change_pin = false where id = p_account_id;
  insert into public.audit_log (actor, action, entity, entity_id)
  values (auth.uid(), 'set_pin', 'account', p_account_id::text);
end;
$$;

-- An admin puts an account back on the default PIN 1234; it must choose a new PIN at sign-in.
create or replace function public.admin_reset_pin(p_account_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
  perform private.set_account_pin(p_account_id, '1234');
  update public.accounts set must_change_pin = true where id = p_account_id;
  insert into public.audit_log (actor, action, entity, entity_id)
  values (auth.uid(), 'reset_pin', 'account', p_account_id::text);
end;
$$;

-- The signed-in account changes its own PIN. The current PIN is required unless the account is on
-- the default PIN and must change it. Wrong current PINs count towards the 15-minute lock.
create or replace function public.change_own_pin(p_current text, p_new text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_account public.accounts%rowtype;
  v_hash text;
  v_failures integer;
begin
  select * into v_account from public.accounts where user_id = auth.uid() and is_active;
  if not found then
    raise exception 'NO_ACCOUNT' using errcode = '42501';
  end if;
  if p_new is null or p_new !~ '^[0-9]{4,6}$' then
    raise exception 'PIN_FORMAT' using errcode = '22023';
  end if;
  if private.is_weak_pin(p_new) then
    raise exception 'PIN_WEAK' using errcode = '22023';
  end if;

  if not v_account.must_change_pin then
    select count(*) into v_failures
    from public.login_attempts
    where account_id = v_account.id and not succeeded
      and attempted_at > now() - interval '15 minutes'
      and attempted_at > coalesce(v_account.pin_changed_at, '-infinity'::timestamptz);
    if v_failures >= 5 then
      raise exception 'LOCKED' using errcode = '42501';
    end if;
    select encrypted_password into v_hash from auth.users where id = v_account.user_id;
    if p_current is null or v_hash is null or extensions.crypt(p_current, v_hash) <> v_hash then
      insert into public.login_attempts (account_id, succeeded) values (v_account.id, false);
      raise exception 'WRONG_PIN' using errcode = '28000';
    end if;
  end if;

  perform private.set_account_pin(v_account.id, p_new);
  update public.accounts set must_change_pin = false where id = v_account.id;
  insert into public.audit_log (actor, branch_id, action, entity, entity_id)
  values (auth.uid(), v_account.branch_id, 'change_own_pin', 'account', v_account.id::text);
end;
$$;

-- The account block of the bootstrap now says whether the PIN must be changed first.
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
    'account', jsonb_build_object(
      'id', v_account.id, 'kind', v_account.kind, 'label', v_account.display_name,
      'must_change_pin', v_account.must_change_pin),
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

-- One sales person on one branch: add (creates the person if new) or remove (switches the link off).
-- Other branches of the person are not touched. Returns the person's id.
create or replace function public.admin_set_staff_link(p_name text, p_branch_id uuid, p_active boolean)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := upper(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'));
  v_employee uuid;
begin
  if not private.is_admin() then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'NAME_REQUIRED' using errcode = '22023';
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id) then
    raise exception 'UNKNOWN_BRANCH' using errcode = '22023';
  end if;

  select id into v_employee from public.employees where upper(odoo_name) = v_name limit 1;
  if v_employee is null then
    if not p_active then
      raise exception 'UNKNOWN_EMPLOYEE' using errcode = '22023';
    end if;
    insert into public.employees (odoo_name) values (v_name) returning id into v_employee;
  end if;

  if p_active then
    update public.employees set is_active = true, updated_at = now() where id = v_employee and not is_active;
    insert into public.employee_branches (employee_id, branch_id, is_active, updated_at)
    values (v_employee, p_branch_id, true, now())
    on conflict (employee_id, branch_id) do update set is_active = true, updated_at = now();
  else
    update public.employee_branches set is_active = false, updated_at = now()
    where employee_id = v_employee and branch_id = p_branch_id;
  end if;

  insert into public.audit_log (actor, branch_id, action, entity, entity_id, details)
  values (auth.uid(), p_branch_id, case when p_active then 'staff_add' else 'staff_remove' end,
          'employee', v_employee::text, jsonb_build_object('name', v_name));
  return v_employee;
end;
$$;

revoke execute on function public.admin_reset_pin(uuid) from public, anon;
revoke execute on function public.change_own_pin(text, text) from public, anon;
revoke execute on function public.admin_set_staff_link(text, uuid, boolean) from public, anon;
grant execute on function public.admin_reset_pin(uuid) to authenticated;
grant execute on function public.change_own_pin(text, text) to authenticated;
grant execute on function public.admin_set_staff_link(text, uuid, boolean) to authenticated;
