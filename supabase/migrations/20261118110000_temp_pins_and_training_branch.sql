-- 1. PINs may be 4 to 8 digits (the admins' temporary PIN is longer than 6).
-- 2. The temporary PIN per account kind lives in a private table (never in the repository and never
--    readable through the API). "Back to the temporary PIN" uses it; branches default to 1234.
-- 3. A new PIN must differ from the current one (so nobody keeps the temporary PIN).
-- 4. Training branches (TST) sell like any branch but stay out of the management dashboard.

create table if not exists private.pin_defaults (
  kind text primary key check (kind in ('admin', 'branch')),
  pin text not null check (pin ~ '^[0-9]{4,8}$')
);
revoke all on private.pin_defaults from public, anon, authenticated;
insert into private.pin_defaults (kind, pin) values ('branch', '1234') on conflict (kind) do nothing;

alter table public.branches add column if not exists is_training boolean not null default false;

create or replace function private.set_account_pin(p_account_id uuid, p_pin text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_account public.accounts%rowtype;
  v_user_id uuid;
  v_email text;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PIN_FORMAT' using errcode = '22023', hint = 'The PIN must be 4 to 8 digits.';
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
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' or v_hash is null or extensions.crypt(p_pin, v_hash) <> v_hash then
    insert into public.login_attempts (account_id, succeeded) values (p_account_id, false);
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PIN', 'attempts_left', greatest(0, 4 - v_failures));
  end if;

  insert into public.login_attempts (account_id, succeeded) values (p_account_id, true);
  return jsonb_build_object('ok', true, 'email', v_email);
end;
$$;

-- An admin puts an account back on its temporary PIN; it must choose a new PIN at sign-in.
create or replace function public.admin_reset_pin(p_account_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
  v_pin text;
begin
  if not private.is_admin() then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
  select kind::text into v_kind from public.accounts where id = p_account_id;
  select pin into v_pin from private.pin_defaults where kind = v_kind;
  perform private.set_account_pin(p_account_id, coalesce(v_pin, '1234'));
  update public.accounts set must_change_pin = true where id = p_account_id;
  insert into public.audit_log (actor, action, entity, entity_id)
  values (auth.uid(), 'reset_pin', 'account', p_account_id::text);
end;
$$;

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
  if p_new is null or p_new !~ '^[0-9]{4,8}$' then
    raise exception 'PIN_FORMAT' using errcode = '22023';
  end if;
  if private.is_weak_pin(p_new) then
    raise exception 'PIN_WEAK' using errcode = '22023';
  end if;
  select encrypted_password into v_hash from auth.users where id = v_account.user_id;

  if not v_account.must_change_pin then
    select count(*) into v_failures
    from public.login_attempts
    where account_id = v_account.id and not succeeded
      and attempted_at > now() - interval '15 minutes'
      and attempted_at > coalesce(v_account.pin_changed_at, '-infinity'::timestamptz);
    if v_failures >= 5 then
      raise exception 'LOCKED' using errcode = '42501';
    end if;
    if p_current is null or v_hash is null or extensions.crypt(p_current, v_hash) <> v_hash then
      insert into public.login_attempts (account_id, succeeded) values (v_account.id, false);
      raise exception 'WRONG_PIN' using errcode = '28000';
    end if;
  end if;
  if v_hash is not null and extensions.crypt(p_new, v_hash) = v_hash then
    raise exception 'PIN_SAME' using errcode = '22023';
  end if;

  perform private.set_account_pin(v_account.id, p_new);
  update public.accounts set must_change_pin = false where id = v_account.id;
  insert into public.audit_log (actor, branch_id, action, entity, entity_id)
  values (auth.uid(), v_account.branch_id, 'change_own_pin', 'account', v_account.id::text);
end;
$$;

-- Today's sales per real branch; training branches are left out so they never inflate the totals.
create or replace function public.branch_sales_today()
returns table(branch_id uuid, code text, pos_name text, invoices integer, pieces integer, total bigint,
              voided integer, voided_total bigint, not_exported integer, phones integer,
              phones_pending integer, last_sync timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
  return query
  select b.id, b.code, b.pos_name,
    count(i.id) filter (where i.status = 'completed')::integer,
    coalesce(sum(i.unit_count) filter (where i.status = 'completed'), 0)::integer,
    coalesce(sum(i.total) filter (where i.status = 'completed'), 0)::bigint,
    count(i.id) filter (where i.status = 'voided')::integer,
    coalesce(sum(i.total) filter (where i.status = 'voided'), 0)::bigint,
    count(i.id) filter (where i.status = 'completed' and i.export_batch_id is null)::integer,
    (select count(*) from public.devices d where d.branch_id = b.id and not d.is_blocked)::integer,
    (select coalesce(sum(d.pending_count), 0) from public.devices d where d.branch_id = b.id and not d.is_blocked)::integer,
    (select max(d.last_synced_at) from public.devices d where d.branch_id = b.id)
  from public.branches b
  left join public.invoices i on i.branch_id = b.id and i.business_date = (now() at time zone 'Africa/Cairo')::date
  where b.is_active and not b.is_training
  group by b.id
  order by coalesce(sum(i.total) filter (where i.status = 'completed'), 0) desc, b.code;
end;
$$;
