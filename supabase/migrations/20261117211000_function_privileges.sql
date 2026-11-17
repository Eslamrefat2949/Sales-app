-- RAVIN Sales App: who may call which function. Functions are executable by everyone by default;
-- anonymous visitors may only list accounts and check a PIN.
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
