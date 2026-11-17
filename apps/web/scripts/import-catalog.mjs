// Loads the Odoo item list (Product Variant export) into Supabase, with the same rules as the admin
// screen. Usage:
//   ADMIN_NAME="ESLAM REFAT" ADMIN_PIN=123456 node apps/web/scripts/import-catalog.mjs <file.xlsx>
import { createClient } from '@supabase/supabase-js';
import { readSheet } from 'read-excel-file/node';
import { findItemListColumns, prepareCatalogImport, readItemListRows } from '../../../packages/domain/src/index.ts';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../src/config/supabase.ts';

const BATCH = 2000;
const [file] = process.argv.slice(2);
const { ADMIN_NAME, ADMIN_PIN } = process.env;
if (!file || !ADMIN_NAME || !ADMIN_PIN) {
  console.error('Usage: ADMIN_NAME="..." ADMIN_PIN=... node apps/web/scripts/import-catalog.mjs <file.xlsx>');
  process.exit(1);
}

const rows = await readSheet(file);
const columns = findItemListColumns(rows[0] ?? []);
if ('missing' in columns) {
  console.error(`Missing columns: ${columns.missing.join(', ')}`);
  process.exit(1);
}
const prepared = prepareCatalogImport(readItemListRows(rows, columns));
console.log(
  `Read ${rows.length - 1} rows: ${prepared.products.length} sellable, ` +
    `${prepared.skipped.noPrice.length} without price, ${prepared.skipped.duplicateBarcode.length} duplicated barcodes, ` +
    `${prepared.skipped.invalid.length} unreadable`,
);

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { data: directory, error: directoryError } = await supabase.rpc('login_directory');
if (directoryError) throw directoryError;
const account = directory.find((entry) => entry.kind === 'admin' && entry.label === ADMIN_NAME);
if (!account) throw new Error(`No admin account named ${ADMIN_NAME}`);
const { data: check, error: checkError } = await supabase.rpc('verify_pin', {
  p_account_id: account.account_id,
  p_pin: ADMIN_PIN,
});
if (checkError) throw checkError;
if (!check.ok) throw new Error(`Sign-in refused: ${check.reason}`);
const { error: signInError } = await supabase.auth.signInWithPassword({ email: check.email, password: ADMIN_PIN });
if (signInError) throw signInError;

const totals = { received: 0, inserted: 0, updated: 0, unchanged: 0 };
for (let start = 0; start < prepared.products.length; start += BATCH) {
  const batch = prepared.products.slice(start, start + BATCH).map((product) => ({
    barcode: product.barcode,
    item_code: product.itemCode,
    size: product.size,
    name: product.name,
    list_price: product.listPrice,
    sale_price: product.salePrice,
  }));
  const { data, error } = await supabase.rpc('upsert_products', { p_rows: batch });
  if (error) throw new Error(`Batch at row ${start}: ${error.message}`);
  for (const key of Object.keys(totals)) totals[key] += data[key];
  process.stdout.write(`\rUploaded ${Math.min(start + BATCH, prepared.products.length)} / ${prepared.products.length}`);
}
console.log(`\nDone: ${totals.inserted} new, ${totals.updated} updated, ${totals.unchanged} unchanged.`);
await supabase.auth.signOut();
