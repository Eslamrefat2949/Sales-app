-- RAVIN Sales App: business functions. Every write with a business rule happens here, in one
-- transaction, never as a direct table write from the app. Errors use stable codes in the message
-- (e.g. VOID_ALREADY_EXPORTED) that the app translates.

-- ---------------------------------------------------------------------------------------------
-- Sign-in with "pick from a list + 6-digit PIN"
-- ---------------------------------------------------------------------------------------------

-- The sign-in list: labels only, never the hidden sign-in emails. Only accounts with a PIN appear.
create function public.login_directory()
returns table (account_id uuid, kind public.account_kind, label text, branch_code text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.kind, a.display_name, b.code
  from public.accounts a
  left join public.branches b on b.id = a.branch_id
  where a.is_active and a.user_id is not null and (b.id is null or b.is_active)
  order by a.kind, b.code nulls first, a.display_name
$$;

-- Checks a PIN. After 5 wrong PINs in 15 minutes the account is locked until the window passes.
-- The hidden email is returned only for the right PIN, so the auth endpoint cannot be guessed at
-- directly; the app then signs in with that email and the PIN.
create function public.verify_pin(p_account_id uuid, p_pin text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user_id uuid;
  v_hash text;
  v_email text;
  v_last_success timestamptz;
  v_failures integer;
begin
  select a.user_id into v_user_id from public.accounts a where a.id = p_account_id and a.is_active;
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'UNKNOWN_ACCOUNT');
  end if;

  select max(attempted_at) into v_last_success
  from public.login_attempts where account_id = p_account_id and succeeded;
  select count(*) into v_failures
  from public.login_attempts
  where account_id = p_account_id and not succeeded
    and attempted_at > now() - interval '15 minutes'
    and attempted_at > coalesce(v_last_success, '-infinity'::timestamptz);
  if v_failures >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'LOCKED');
  end if;

  select u.encrypted_password, u.email into v_hash, v_email from auth.users u where u.id = v_user_id;
  if p_pin is null or p_pin !~ '^[0-9]{6}$' or v_hash is null or extensions.crypt(p_pin, v_hash) <> v_hash then
    insert into public.login_attempts (account_id, succeeded) values (p_account_id, false);
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PIN', 'attempts_left', greatest(0, 4 - v_failures));
  end if;

  insert into public.login_attempts (account_id, succeeded) values (p_account_id, true);
  return jsonb_build_object('ok', true, 'email', v_email);
end;
$$;

-- Creates the hidden auth user on first use, or changes the PIN and signs out every phone of the account.
create function private.set_account_pin(p_account_id uuid, p_pin text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_account public.accounts%rowtype;
  v_user_id uuid;
  v_email text;
begin
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    raise exception 'PIN_FORMAT' using errcode = '22023', hint = 'The PIN must be exactly 6 digits.';
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
    delete from auth.sessions where user_id = v_account.user_id;
  end if;

  delete from public.login_attempts where account_id = p_account_id;
end;
$$;

create function public.admin_set_pin(p_account_id uuid, p_pin text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
  perform private.set_account_pin(p_account_id, p_pin);
  insert into public.audit_log (actor, action, entity, entity_id)
  values (auth.uid(), 'set_pin', 'account', p_account_id::text);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Everything a phone needs after sign-in (except the catalog, which is larger and cached)
-- ---------------------------------------------------------------------------------------------
create function public.app_bootstrap()
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
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', e.odoo_name,
        'in_branch', exists (select 1 from public.employee_branches eb where eb.employee_id = e.id and eb.branch_id = v_branch.id))
        order by e.odoo_name)
      from public.employees e where e.is_active), '[]'::jsonb),
    'catalog_version', (select coalesce(max(updated_at), 'epoch'::timestamptz) from public.products)
  );
end;
$$;

-- The whole active catalog as compact rows: [barcode, item_code, size, list_price, sale_price, discountable, name].
create function public.catalog_snapshot()
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_array(barcode, item_code, size, list_price, sale_price, discountable, name)
    order by item_code, size), '[]'::jsonb)
  from public.products
  where is_active
$$;

-- ---------------------------------------------------------------------------------------------
-- Phones and invoice numbers
-- ---------------------------------------------------------------------------------------------
create function public.register_device()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_branch uuid := private.current_branch_id();
  v_number integer;
  v_id uuid;
begin
  if v_branch is null then
    raise exception 'BRANCH_ONLY' using errcode = '42501';
  end if;
  perform 1 from public.branches where id = v_branch for update;
  select count(*) + 1 into v_number from public.devices where branch_id = v_branch;
  insert into public.devices (branch_id, label, registered_by, last_seen_at)
  values (v_branch, 'Phone ' || v_number, auth.uid(), now())
  returning id into v_id;
  insert into public.audit_log (actor, branch_id, action, entity, entity_id)
  values (auth.uid(), v_branch, 'register_device', 'device', v_id::text);
  return jsonb_build_object('id', v_id, 'number', v_number);
end;
$$;

-- Hands a phone a block of invoice numbers it alone may use (works for offline selling).
create function public.reserve_invoice_numbers(p_device_id uuid, p_count integer default 100)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_branch uuid := private.current_branch_id();
  v_count integer := least(greatest(coalesce(p_count, 100), 1), 500);
  v_first integer;
begin
  if v_branch is null or not exists (
    select 1 from public.devices where id = p_device_id and branch_id = v_branch and not is_blocked) then
    raise exception 'DEVICE_NOT_ALLOWED' using errcode = '42501';
  end if;
  update public.branches set next_invoice_seq = next_invoice_seq + v_count
  where id = v_branch
  returning next_invoice_seq - v_count into v_first;
  insert into public.invoice_number_blocks (branch_id, device_id, first_seq, last_seq)
  values (v_branch, p_device_id, v_first, v_first + v_count - 1);
  update public.devices set last_seen_at = now() where id = p_device_id;
  return jsonb_build_object('first_seq', v_first, 'last_seq', v_first + v_count - 1);
end;
$$;

-- The phone reports how many invoices it still holds, so the branch is warned before exporting.
create function public.device_heartbeat(p_device_id uuid, p_pending integer)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.devices
  set last_seen_at = now(), pending_count = greatest(coalesce(p_pending, 0), 0)
  where id = p_device_id and branch_id = private.current_branch_id();
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------------------------

-- Receives one invoice from a phone. Idempotent: sending the same invoice again is a no-op.
-- Structural problems are rejected; pricing inconsistencies are accepted (the sale happened) and
-- flagged for review.
create function public.sync_invoice(p_invoice jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_branch uuid := private.current_branch_id();
  v_branch_code text;
  v_device uuid := (p_invoice ->> 'device_id')::uuid;
  v_seq integer := (p_invoice ->> 'seq')::integer;
  v_number text := p_invoice ->> 'number';
  v_total bigint := (p_invoice ->> 'total')::bigint;
  v_existing public.invoices%rowtype;
  v_id uuid;
  v_line_count integer;
  v_payment_count integer;
  v_lines_sale bigint;
  v_lines_final bigint;
  v_paid bigint;
  v_notes text[] := '{}';
begin
  if v_branch is null then
    raise exception 'BRANCH_ONLY' using errcode = '42501';
  end if;

  select * into v_existing from public.invoices where number = v_number;
  if found then
    if v_existing.branch_id = v_branch and v_existing.device_id = v_device then
      return jsonb_build_object('id', v_existing.id, 'duplicate', true);
    end if;
    raise exception 'INVOICE_NUMBER_TAKEN' using errcode = '23505';
  end if;

  select code into v_branch_code from public.branches where id = v_branch;
  if not exists (select 1 from public.devices where id = v_device and branch_id = v_branch and not is_blocked) then
    raise exception 'DEVICE_NOT_ALLOWED' using errcode = '42501';
  end if;
  if v_number is distinct from v_branch_code || '-APP-' || lpad(v_seq::text, 6, '0') then
    raise exception 'INVOICE_NUMBER_INVALID' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.invoice_number_blocks
    where device_id = v_device and v_seq between first_seq and last_seq) then
    raise exception 'INVOICE_NUMBER_NOT_RESERVED' using errcode = '22023';
  end if;
  if not exists (select 1 from public.employees where id = (p_invoice ->> 'sales_person_id')::uuid) then
    raise exception 'UNKNOWN_SALES_PERSON' using errcode = '22023';
  end if;

  insert into public.invoices (
    number, branch_id, device_id, seq, business_date, sold_at, sales_person_id,
    customer_mobile, customer_name, default_discount_percent, offer,
    unit_count, list_total, sale_total, default_discount_total, offer_discount_total, total, change_given)
  values (
    v_number, v_branch, v_device, v_seq,
    (p_invoice ->> 'business_date')::date, (p_invoice ->> 'sold_at')::timestamptz,
    (p_invoice ->> 'sales_person_id')::uuid,
    nullif(p_invoice ->> 'customer_mobile', ''), nullif(trim(p_invoice ->> 'customer_name'), ''),
    (p_invoice ->> 'default_discount_percent')::numeric, p_invoice -> 'offer',
    (p_invoice ->> 'unit_count')::integer, (p_invoice ->> 'list_total')::bigint,
    (p_invoice ->> 'sale_total')::bigint, (p_invoice ->> 'default_discount_total')::bigint,
    (p_invoice ->> 'offer_discount_total')::bigint, v_total,
    coalesce((p_invoice ->> 'change_given')::bigint, 0))
  returning id into v_id;

  insert into public.invoice_lines (
    invoice_id, seq, barcode, item_code, size, list_price, sale_price, discountable,
    treatment, discount_percent, discount_amount, final_price)
  select v_id, l.seq, l.barcode, l.item_code, l.size, l.list_price, l.sale_price, l.discountable,
    l.treatment, l.discount_percent, l.discount_amount, l.final_price
  from jsonb_to_recordset(p_invoice -> 'lines') as l(
    seq integer, barcode text, item_code text, size text, list_price bigint, sale_price bigint,
    discountable boolean, treatment public.unit_treatment, discount_percent numeric,
    discount_amount bigint, final_price bigint);
  get diagnostics v_line_count = row_count;

  insert into public.invoice_payments (invoice_id, method_id, journal, amount)
  select v_id, bpm.method_id, bpm.journal, p.amount
  from jsonb_to_recordset(p_invoice -> 'payments') as p(method_id uuid, amount bigint)
  join public.branch_payment_methods bpm on bpm.branch_id = v_branch and bpm.method_id = p.method_id;
  get diagnostics v_payment_count = row_count;
  if v_payment_count <> jsonb_array_length(coalesce(p_invoice -> 'payments', '[]'::jsonb)) then
    raise exception 'PAYMENT_METHOD_NOT_IN_BRANCH' using errcode = '22023';
  end if;

  select coalesce(sum(sale_price), 0), coalesce(sum(final_price), 0)
  into v_lines_sale, v_lines_final from public.invoice_lines where invoice_id = v_id;
  select coalesce(sum(amount), 0) into v_paid from public.invoice_payments where invoice_id = v_id;
  if v_line_count <> (p_invoice ->> 'unit_count')::integer then
    v_notes := v_notes || 'piece count differs from lines';
  end if;
  if v_lines_sale <> (p_invoice ->> 'sale_total')::bigint then
    v_notes := v_notes || 'sale total differs from lines';
  end if;
  -- Lines are rounded one by one, the total once: they may differ by at most half a piaster per line.
  if abs(v_lines_final - v_total) > v_line_count then
    v_notes := v_notes || 'total differs from lines';
  end if;
  if v_paid <> v_total then
    v_notes := v_notes || 'payments differ from total';
  end if;
  if cardinality(v_notes) > 0 then
    update public.invoices set needs_review = true, review_note = array_to_string(v_notes, '; ') where id = v_id;
  end if;

  update public.devices set last_synced_at = now(), last_seen_at = now() where id = v_device;
  return jsonb_build_object('id', v_id, 'duplicate', false, 'needs_review', cardinality(v_notes) > 0);
end;
$$;

-- Voids a whole invoice (a return): same day, before export, with a reason.
create function public.void_invoice(p_number text, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.invoices%rowtype;
begin
  select * into v_invoice from public.invoices where number = p_number for update;
  if not found or not private.can_see_branch(v_invoice.branch_id) then
    raise exception 'VOID_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_invoice.status = 'voided' then
    raise exception 'VOID_ALREADY_VOIDED' using errcode = '22023';
  end if;
  if v_invoice.export_batch_id is not null then
    raise exception 'VOID_ALREADY_EXPORTED' using errcode = '22023';
  end if;
  if v_invoice.business_date <> (now() at time zone 'Africa/Cairo')::date then
    raise exception 'VOID_DIFFERENT_DAY' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'VOID_REASON_REQUIRED' using errcode = '22023';
  end if;
  update public.invoices
  set status = 'voided', void_reason = trim(p_reason), voided_at = now(), voided_by = auth.uid()
  where id = v_invoice.id;
  insert into public.audit_log (actor, branch_id, action, entity, entity_id, details)
  values (auth.uid(), v_invoice.branch_id, 'void_invoice', 'invoice', v_invoice.number,
          jsonb_build_object('reason', trim(p_reason), 'total', v_invoice.total));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Export to Odoo
-- ---------------------------------------------------------------------------------------------

-- Puts every completed invoice of the branch not exported yet into a new batch and locks them.
-- Branch accounts export their own branch; admins pass the branch.
create function public.create_export_batch(p_branch_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_branch uuid := coalesce(private.current_branch_id(), case when private.is_admin() then p_branch_id end);
  v_batch uuid;
  v_count integer;
  v_total bigint;
  v_pending integer;
begin
  if v_branch is null then
    raise exception 'BRANCH_REQUIRED' using errcode = '42501';
  end if;
  perform 1 from public.branches where id = v_branch for update;

  select count(*), coalesce(sum(total), 0) into v_count, v_total
  from public.invoices where branch_id = v_branch and export_batch_id is null and status = 'completed';
  select coalesce(sum(pending_count), 0) into v_pending
  from public.devices where branch_id = v_branch and not is_blocked;
  if v_count = 0 then
    return jsonb_build_object('batch_id', null, 'invoice_count', 0, 'total', 0, 'pending_on_phones', v_pending);
  end if;

  insert into public.export_batches (branch_id, created_by, invoice_count, total)
  values (v_branch, auth.uid(), v_count, v_total)
  returning id into v_batch;
  update public.invoices set export_batch_id = v_batch
  where branch_id = v_branch and export_batch_id is null and status = 'completed';
  insert into public.audit_log (actor, branch_id, action, entity, entity_id, details)
  values (auth.uid(), v_branch, 'export', 'export_batch', v_batch::text,
          jsonb_build_object('invoices', v_count, 'total', v_total));
  return jsonb_build_object('batch_id', v_batch, 'invoice_count', v_count, 'total', v_total, 'pending_on_phones', v_pending);
end;
$$;

-- Counts a repeat download of an earlier batch, so double imports into Odoo are visible.
create function public.record_export_download(p_batch_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  update public.export_batches
  set download_count = download_count + 1, last_downloaded_at = now()
  where id = p_batch_id and private.can_see_branch(branch_id)
  returning download_count into v_count;
  if v_count is null then
    raise exception 'EXPORT_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------------------------

-- Adds new items and updates changed ones from the Odoo item list; never deletes. Rows arrive in
-- batches: [{barcode, item_code, size, name, list_price, sale_price}], prices in piasters.
create function public.upsert_products(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_received integer := jsonb_array_length(p_rows);
  v_inserted integer;
  v_updated integer;
begin
  if not private.is_admin() then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
  with incoming as (
    select r.barcode, r.item_code, r.size, nullif(trim(r.name), '') as name, r.list_price, r.sale_price
    from jsonb_to_recordset(p_rows) as r(
      barcode text, item_code text, size text, name text, list_price bigint, sale_price bigint)
  ), written as (
    insert into public.products (barcode, barcode_key, item_code, size, name, list_price, sale_price)
    select barcode, upper(regexp_replace(barcode, '\s', '', 'g')), item_code, size, name, list_price, sale_price
    from incoming
    on conflict (barcode) do update
      set item_code = excluded.item_code,
          size = excluded.size,
          name = coalesce(excluded.name, public.products.name),
          list_price = excluded.list_price,
          sale_price = excluded.sale_price,
          is_active = true
      where (public.products.item_code, public.products.size, public.products.list_price,
             public.products.sale_price, public.products.is_active)
        is distinct from (excluded.item_code, excluded.size, excluded.list_price, excluded.sale_price, true)
         or (excluded.name is not null and excluded.name is distinct from public.products.name)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted)
  into v_inserted, v_updated from written;
  return jsonb_build_object(
    'received', v_received, 'inserted', v_inserted, 'updated', v_updated,
    'unchanged', v_received - v_inserted - v_updated);
end;
$$;

-- Marks items (by item code, all sizes) as taking discounts or not.
create function public.set_items_discountable(p_item_codes text[], p_discountable boolean)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if not private.is_admin() then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
  update public.products set discountable = p_discountable
  where item_code = any (p_item_codes) and discountable is distinct from p_discountable;
  get diagnostics v_count = row_count;
  insert into public.audit_log (actor, action, entity, details)
  values (auth.uid(), 'set_discountable', 'products',
          jsonb_build_object('item_codes', p_item_codes, 'discountable', p_discountable, 'rows', v_count));
  return v_count;
end;
$$;

-- Today's sales per branch for the admin dashboard.
create function public.branch_sales_today()
returns table (
  branch_id uuid, code text, pos_name text, invoices integer, pieces integer, total bigint,
  voided integer, voided_total bigint, not_exported integer, phones integer, phones_pending integer,
  last_sync timestamptz)
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
  where b.is_active
  group by b.id
  order by coalesce(sum(i.total) filter (where i.status = 'completed'), 0) desc, b.code;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
revoke execute on function private.set_account_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.login_directory() to anon, authenticated;
grant execute on function public.verify_pin(uuid, text) to anon, authenticated;
grant execute on function public.admin_set_pin(uuid, text) to authenticated;
grant execute on function public.app_bootstrap() to authenticated;
grant execute on function public.catalog_snapshot() to authenticated;
grant execute on function public.register_device() to authenticated;
grant execute on function public.reserve_invoice_numbers(uuid, integer) to authenticated;
grant execute on function public.device_heartbeat(uuid, integer) to authenticated;
grant execute on function public.sync_invoice(jsonb) to authenticated;
grant execute on function public.void_invoice(text, text) to authenticated;
grant execute on function public.create_export_batch(uuid) to authenticated;
grant execute on function public.record_export_download(uuid) to authenticated;
grant execute on function public.upsert_products(jsonb) to authenticated;
grant execute on function public.set_items_discountable(text[], boolean) to authenticated;
grant execute on function public.branch_sales_today() to authenticated;
