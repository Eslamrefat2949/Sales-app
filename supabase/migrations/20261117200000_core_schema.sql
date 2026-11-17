-- RAVIN Sales App: core schema.
-- Money is stored as integer piasters (bigint). Business rules: docs/business-rules.md.
-- Branch users only ever see their own branch; admins see everything. Writes that carry business
-- rules (devices, invoice numbers, voids) go through functions, never direct table writes.

create schema if not exists private;

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------
create type public.account_kind as enum ('admin', 'branch');
create type public.payment_kind as enum ('cash', 'card', 'other');
create type public.invoice_status as enum ('completed', 'voided');
create type public.unit_treatment as enum ('default_discount', 'offer_paid', 'offer_free', 'no_discount');

create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Branches and sign-in accounts
-- ---------------------------------------------------------------------------------------------
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{2,8}$'),
  pos_name text not null check (length(trim(pos_name)) > 0),
  odoo_branch text not null,
  journal_suffix text not null,
  next_invoice_seq integer not null default 1 check (next_invoice_seq > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.branches.code is 'Short code (LOC): sign-in name and invoice number prefix, e.g. OCT.';
comment on column public.branches.pos_name is 'Odoo Point of Sale name, e.g. 6th of October Outlet Mall.';
comment on column public.branches.journal_suffix is 'Suffix of the branch payment journals in Odoo, e.g. OCT2.';
comment on column public.branches.next_invoice_seq is 'Next invoice number not yet handed to any phone.';

-- One sign-in per branch and one per admin. Sign-in is "pick from a list + PIN"; the PIN is the
-- password of the linked auth user, whose email is random and never shown.
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  kind public.account_kind not null,
  branch_id uuid unique references public.branches (id),
  display_name text not null check (length(trim(display_name)) > 0),
  user_id uuid unique references auth.users (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_branch_matches_kind check ((kind = 'branch') = (branch_id is not null))
);
comment on table public.accounts is 'Sign-in accounts: one per branch, one per admin. user_id is set once a PIN exists.';

create table public.login_attempts (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts (id) on delete cascade,
  attempted_at timestamptz not null default now(),
  succeeded boolean not null
);
create index login_attempts_account_time on public.login_attempts (account_id, attempted_at desc);
comment on table public.login_attempts is 'PIN attempts, used to lock an account after repeated wrong PINs.';

-- ---------------------------------------------------------------------------------------------
-- Payment methods
-- ---------------------------------------------------------------------------------------------
create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  name_ar text,
  kind public.payment_kind not null,
  sort_order integer not null default 0,
  is_active boolean not null default true
);
comment on column public.payment_methods.name is 'Odoo payment method name, e.g. VISA BM. Only cash may exceed the total.';

create table public.branch_payment_methods (
  branch_id uuid not null references public.branches (id) on delete cascade,
  method_id uuid not null references public.payment_methods (id),
  journal text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  primary key (branch_id, method_id)
);
create index branch_payment_methods_method on public.branch_payment_methods (method_id);
comment on column public.branch_payment_methods.journal is 'Exact Odoo journal exported as payment_method, e.g. VISA BM - OCT2.';

-- ---------------------------------------------------------------------------------------------
-- Sales people
-- ---------------------------------------------------------------------------------------------
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  odoo_name text not null unique check (length(trim(odoo_name)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.employees.odoo_name is 'Name exactly as in Odoo and the export, e.g. 9173-HABIBA MOHAMED SEDAY ELSAIED.';

create table public.employee_branches (
  employee_id uuid not null references public.employees (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  primary key (employee_id, branch_id)
);
create index employee_branches_branch on public.employee_branches (branch_id);

-- ---------------------------------------------------------------------------------------------
-- Items, prices, settings and offers
-- ---------------------------------------------------------------------------------------------
create table public.products (
  barcode text primary key check (length(trim(barcode)) > 0),
  barcode_key text not null unique,
  item_code text not null,
  size text not null,
  name text,
  list_price bigint not null check (list_price >= 0),
  sale_price bigint not null check (sale_price > 0),
  discountable boolean not null default true,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);
create index products_item_code on public.products (item_code);
create index products_updated_at on public.products (updated_at);
comment on column public.products.barcode is 'Odoo Internal Reference, exactly (e.g. O178475-One Size); exported as product_barcode.';
comment on column public.products.barcode_key is 'Barcode in upper case without spaces, for scanner lookups.';
comment on column public.products.sale_price is 'Price on the system (after), in piasters: Odoo price_unit and the base of every discount.';
comment on column public.products.list_price is 'Original price (before, MSRP), in piasters.';

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  buy_qty integer not null,
  pay_qty integer not null,
  starts_on date,
  ends_on date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offers_quantities check (pay_qty >= 1 and buy_qty > pay_qty),
  constraint offers_dates check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

-- ---------------------------------------------------------------------------------------------
-- Phones and invoice numbers
-- ---------------------------------------------------------------------------------------------
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  label text not null,
  registered_by uuid references auth.users (id) on delete set null,
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_synced_at timestamptz,
  pending_count integer not null default 0 check (pending_count >= 0),
  is_blocked boolean not null default false
);
create index devices_branch on public.devices (branch_id);

-- Each phone receives blocks of invoice numbers while online, so it can sell offline without ever
-- issuing a number another phone could issue.
create table public.invoice_number_blocks (
  id bigint generated always as identity primary key,
  branch_id uuid not null references public.branches (id),
  device_id uuid not null references public.devices (id),
  first_seq integer not null check (first_seq > 0),
  last_seq integer not null,
  reserved_at timestamptz not null default now(),
  constraint invoice_number_blocks_range check (last_seq >= first_seq)
);
create index invoice_number_blocks_branch on public.invoice_number_blocks (branch_id, first_seq);
create index invoice_number_blocks_device on public.invoice_number_blocks (device_id);

-- ---------------------------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------------------------
create table public.export_batches (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  invoice_count integer not null check (invoice_count >= 0),
  total bigint not null,
  download_count integer not null default 1 check (download_count >= 1),
  last_downloaded_at timestamptz not null default now()
);
create index export_batches_branch on public.export_batches (branch_id, created_at desc);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  branch_id uuid not null references public.branches (id),
  device_id uuid not null references public.devices (id),
  seq integer not null check (seq > 0),
  business_date date not null,
  sold_at timestamptz not null,
  synced_at timestamptz not null default now(),
  sales_person_id uuid not null references public.employees (id),
  customer_mobile text check (customer_mobile is null or customer_mobile ~ '^01[0125][0-9]{8}$'),
  customer_name text,
  default_discount_percent numeric(5, 2) not null,
  offer jsonb,
  unit_count integer not null check (unit_count > 0),
  list_total bigint not null,
  sale_total bigint not null,
  default_discount_total bigint not null,
  offer_discount_total bigint not null,
  total bigint not null check (total >= 0),
  change_given bigint not null default 0 check (change_given >= 0),
  status public.invoice_status not null default 'completed',
  void_reason text,
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  export_batch_id uuid references public.export_batches (id),
  needs_review boolean not null default false,
  review_note text,
  unique (branch_id, seq),
  constraint invoices_void_consistent check ((status = 'voided') = (voided_at is not null)),
  constraint invoices_voided_not_exported check (status = 'completed' or export_batch_id is null)
);
create index invoices_branch_date on public.invoices (branch_id, business_date);
create index invoices_device on public.invoices (device_id);
create index invoices_sales_person on public.invoices (sales_person_id);
create index invoices_export_batch on public.invoices (export_batch_id);
create index invoices_to_export on public.invoices (branch_id) where export_batch_id is null and status = 'completed';
comment on column public.invoices.number is 'Invoice number and Odoo order_ref, e.g. OCT-APP-000042.';

create table public.invoice_lines (
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  seq integer not null check (seq > 0),
  barcode text not null,
  item_code text not null,
  size text not null,
  list_price bigint not null,
  sale_price bigint not null,
  discountable boolean not null,
  treatment public.unit_treatment not null,
  discount_percent numeric(5, 2) not null,
  discount_amount bigint not null,
  final_price bigint not null check (final_price >= 0),
  primary key (invoice_id, seq)
);
comment on table public.invoice_lines is 'One row per piece, priced at sale time (a snapshot: later price changes never alter it).';

create table public.invoice_payments (
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  method_id uuid not null references public.payment_methods (id),
  journal text not null,
  amount bigint not null check (amount > 0),
  primary key (invoice_id, method_id)
);
create index invoice_payments_method on public.invoice_payments (method_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid references auth.users (id) on delete set null,
  branch_id uuid references public.branches (id),
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}'
);
create index audit_log_branch_time on public.audit_log (branch_id, at desc);
create index audit_log_actor on public.audit_log (actor);

-- updated_at triggers
create trigger branches_updated_at before update on public.branches for each row execute function private.set_updated_at();
create trigger accounts_updated_at before update on public.accounts for each row execute function private.set_updated_at();
create trigger employees_updated_at before update on public.employees for each row execute function private.set_updated_at();
create trigger products_updated_at before update on public.products for each row execute function private.set_updated_at();
create trigger offers_updated_at before update on public.offers for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Who is signed in
-- ---------------------------------------------------------------------------------------------
create function private.current_account_kind() returns public.account_kind
language sql stable security definer set search_path = '' as $$
  select kind from public.accounts where user_id = auth.uid() and is_active
$$;

create function private.current_branch_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select branch_id from public.accounts where user_id = auth.uid() and is_active
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select kind = 'admin' from public.accounts where user_id = auth.uid() and is_active), false)
$$;

create function private.can_see_branch(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() or target = private.current_branch_id()
$$;

grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Row level security. Signed-in users only; anonymous visitors see nothing (the sign-in list is
-- served by a function).
-- ---------------------------------------------------------------------------------------------
alter table public.branches enable row level security;
alter table public.accounts enable row level security;
alter table public.login_attempts enable row level security;
alter table public.payment_methods enable row level security;
alter table public.branch_payment_methods enable row level security;
alter table public.employees enable row level security;
alter table public.employee_branches enable row level security;
alter table public.products enable row level security;
alter table public.app_settings enable row level security;
alter table public.offers enable row level security;
alter table public.devices enable row level security;
alter table public.invoice_number_blocks enable row level security;
alter table public.export_batches enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.invoice_payments enable row level security;
alter table public.audit_log enable row level security;

-- Reference data every signed-in user needs (catalog, payment methods, sales people, settings).
create policy "signed-in users read payment methods" on public.payment_methods for select to authenticated using (true);
create policy "signed-in users read employees" on public.employees for select to authenticated using (true);
create policy "signed-in users read employee branches" on public.employee_branches for select to authenticated using (true);
create policy "signed-in users read products" on public.products for select to authenticated using (true);
create policy "signed-in users read settings" on public.app_settings for select to authenticated using (true);
create policy "signed-in users read offers" on public.offers for select to authenticated using (true);

-- Branch-scoped reads.
create policy "read own branch or all as admin" on public.branches for select to authenticated
  using ((select private.can_see_branch(id)));
create policy "read own branch methods or all as admin" on public.branch_payment_methods for select to authenticated
  using ((select private.can_see_branch(branch_id)));
create policy "read own branch devices or all as admin" on public.devices for select to authenticated
  using ((select private.can_see_branch(branch_id)));
create policy "read own branch number blocks or all as admin" on public.invoice_number_blocks for select to authenticated
  using ((select private.can_see_branch(branch_id)));
create policy "read own branch exports or all as admin" on public.export_batches for select to authenticated
  using ((select private.can_see_branch(branch_id)));
create policy "read own branch invoices or all as admin" on public.invoices for select to authenticated
  using ((select private.can_see_branch(branch_id)));
create policy "read lines of visible invoices" on public.invoice_lines for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and (select private.can_see_branch(i.branch_id))));
create policy "read payments of visible invoices" on public.invoice_payments for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and (select private.can_see_branch(i.branch_id))));

-- Admin-only reads.
create policy "admins read accounts" on public.accounts for select to authenticated using ((select private.is_admin()));
create policy "admins read audit log" on public.audit_log for select to authenticated using ((select private.is_admin()));

-- Admin writes on reference data.
create policy "admins insert branches" on public.branches for insert to authenticated with check ((select private.is_admin()));
create policy "admins update branches" on public.branches for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admins insert payment methods" on public.payment_methods for insert to authenticated with check ((select private.is_admin()));
create policy "admins update payment methods" on public.payment_methods for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admins insert branch methods" on public.branch_payment_methods for insert to authenticated with check ((select private.is_admin()));
create policy "admins update branch methods" on public.branch_payment_methods for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admins insert employees" on public.employees for insert to authenticated with check ((select private.is_admin()));
create policy "admins update employees" on public.employees for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admins insert employee branches" on public.employee_branches for insert to authenticated with check ((select private.is_admin()));
create policy "admins delete employee branches" on public.employee_branches for delete to authenticated using ((select private.is_admin()));
create policy "admins insert products" on public.products for insert to authenticated with check ((select private.is_admin()));
create policy "admins update products" on public.products for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admins insert settings" on public.app_settings for insert to authenticated with check ((select private.is_admin()));
create policy "admins update settings" on public.app_settings for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admins insert offers" on public.offers for insert to authenticated with check ((select private.is_admin()));
create policy "admins update offers" on public.offers for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admins update devices" on public.devices for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- No client ever deletes invoices, lines, payments, accounts or audit rows.
revoke all on all tables in schema public from anon;
