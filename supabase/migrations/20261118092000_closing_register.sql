-- Each close of day remembers the sale dates it covers (for the sheet name and the history) and the
-- invoices voided since the previous close (for the closing summary image).
alter table public.export_batches
  add column if not exists first_business_date date,
  add column if not exists last_business_date date,
  add column if not exists voided_count integer not null default 0,
  add column if not exists voided_total bigint not null default 0;

update public.export_batches b
set first_business_date = d.first_date, last_business_date = d.last_date
from (
  select export_batch_id, min(business_date) as first_date, max(business_date) as last_date
  from public.invoices where export_batch_id is not null group by export_batch_id
) d
where d.export_batch_id = b.id and b.first_business_date is null;

create or replace function public.create_export_batch(p_branch_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_branch uuid := coalesce(private.current_branch_id(), case when private.is_admin() then p_branch_id end);
  v_batch uuid;
  v_count integer;
  v_total bigint;
  v_first date;
  v_last date;
  v_since timestamptz;
  v_void_count integer;
  v_void_total bigint;
  v_pending integer;
begin
  if v_branch is null then
    raise exception 'BRANCH_REQUIRED' using errcode = '42501';
  end if;
  perform 1 from public.branches where id = v_branch for update;

  select count(*), coalesce(sum(total), 0), min(business_date), max(business_date)
    into v_count, v_total, v_first, v_last
  from public.invoices where branch_id = v_branch and export_batch_id is null and status = 'completed';
  select coalesce(sum(pending_count), 0) into v_pending
  from public.devices where branch_id = v_branch and not is_blocked;
  if v_count = 0 then
    return jsonb_build_object('batch_id', null, 'invoice_count', 0, 'total', 0, 'pending_on_phones', v_pending);
  end if;

  select max(created_at) into v_since from public.export_batches where branch_id = v_branch;
  select count(*), coalesce(sum(total), 0) into v_void_count, v_void_total
  from public.invoices
  where branch_id = v_branch and status = 'voided' and voided_at > coalesce(v_since, '-infinity'::timestamptz);

  insert into public.export_batches (
    branch_id, created_by, invoice_count, total, first_business_date, last_business_date, voided_count, voided_total)
  values (v_branch, auth.uid(), v_count, v_total, v_first, v_last, v_void_count, v_void_total)
  returning id into v_batch;
  update public.invoices set export_batch_id = v_batch
  where branch_id = v_branch and export_batch_id is null and status = 'completed';
  insert into public.audit_log (actor, branch_id, action, entity, entity_id, details)
  values (auth.uid(), v_branch, 'export', 'export_batch', v_batch::text,
          jsonb_build_object('invoices', v_count, 'total', v_total, 'voided', v_void_count));
  return jsonb_build_object('batch_id', v_batch, 'invoice_count', v_count, 'total', v_total, 'pending_on_phones', v_pending);
end;
$$;
