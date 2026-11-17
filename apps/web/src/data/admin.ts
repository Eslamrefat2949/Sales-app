import type { CatalogProduct, StaffRow } from '@ravin-sales/domain';
import { supabase, unwrap } from '../lib/supabase.ts';

export interface BranchToday {
  readonly branchId: string;
  readonly code: string;
  readonly posName: string;
  readonly invoices: number;
  readonly pieces: number;
  readonly total: number;
  readonly voided: number;
  readonly voidedTotal: number;
  readonly notExported: number;
  readonly phones: number;
  readonly phonesPending: number;
  readonly lastSync: string | null;
}

export async function fetchBranchesToday(): Promise<BranchToday[]> {
  const rows = unwrap(await supabase.rpc('branch_sales_today')) as {
    branch_id: string;
    code: string;
    pos_name: string;
    invoices: number;
    pieces: number;
    total: number;
    voided: number;
    voided_total: number;
    not_exported: number;
    phones: number;
    phones_pending: number;
    last_sync: string | null;
  }[];
  return rows.map((row) => ({
    branchId: row.branch_id,
    code: row.code,
    posName: row.pos_name,
    invoices: row.invoices,
    pieces: row.pieces,
    total: Number(row.total),
    voided: row.voided,
    voidedTotal: Number(row.voided_total),
    notExported: row.not_exported,
    phones: row.phones,
    phonesPending: row.phones_pending,
    lastSync: row.last_sync,
  }));
}

const BATCH = 2000;

export async function uploadProducts(
  products: readonly CatalogProduct[],
  onProgress: (done: number) => void,
): Promise<{ inserted: number; updated: number; unchanged: number }> {
  const totals = { inserted: 0, updated: 0, unchanged: 0 };
  for (let start = 0; start < products.length; start += BATCH) {
    const batch = products.slice(start, start + BATCH).map((product) => ({
      barcode: product.barcode,
      item_code: product.itemCode,
      size: product.size,
      name: product.name,
      list_price: product.listPrice,
      sale_price: product.salePrice,
    }));
    const result = unwrap(await supabase.rpc('upsert_products', { p_rows: batch })) as typeof totals;
    totals.inserted += result.inserted;
    totals.updated += result.updated;
    totals.unchanged += result.unchanged;
    onProgress(Math.min(start + BATCH, products.length));
  }
  return totals;
}

export async function setItemsDiscountable(itemCodes: readonly string[], discountable: boolean): Promise<number> {
  return unwrap(
    await supabase.rpc('set_items_discountable', { p_item_codes: itemCodes, p_discountable: discountable }),
  ) as number;
}

export interface OfferRow {
  readonly id: string;
  readonly name: string;
  readonly buyQty: number;
  readonly payQty: number;
  readonly isActive: boolean;
}

export async function loadSettings(): Promise<{ defaultDiscountPercent: number; offers: OfferRow[] }> {
  const [setting, offers] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'default_discount_percent').maybeSingle(),
    supabase.from('offers').select('id, name, buy_qty, pay_qty, is_active').order('created_at'),
  ]);
  const value = (unwrap(setting) as { value: number } | null)?.value ?? 30;
  return {
    defaultDiscountPercent: Number(value),
    offers: (
      unwrap(offers) as { id: string; name: string; buy_qty: number; pay_qty: number; is_active: boolean }[]
    ).map((row) => ({
      id: row.id,
      name: row.name,
      buyQty: row.buy_qty,
      payQty: row.pay_qty,
      isActive: row.is_active,
    })),
  };
}

export async function saveDefaultDiscount(percent: number): Promise<void> {
  const { data } = await supabase.auth.getUser();
  unwrap(
    await supabase
      .from('app_settings')
      .update({ value: percent, updated_at: new Date().toISOString(), updated_by: data.user?.id ?? null })
      .eq('key', 'default_discount_percent'),
  );
}

export async function saveOffer(offer: OfferRow): Promise<void> {
  unwrap(
    await supabase
      .from('offers')
      .update({
        buy_qty: offer.buyQty,
        pay_qty: offer.payQty,
        is_active: offer.isActive,
        name: `Buy ${offer.buyQty} pay ${offer.payQty}`,
      })
      .eq('id', offer.id),
  );
}

export interface AccountRow {
  readonly id: string;
  readonly kind: 'admin' | 'branch';
  readonly label: string;
  readonly hasPin: boolean;
  /** Still on the default PIN 1234. */
  readonly onDefaultPin: boolean;
}

export async function listAccounts(): Promise<AccountRow[]> {
  const rows = unwrap(
    await supabase
      .from('accounts')
      .select('id, kind, display_name, user_id, must_change_pin')
      .eq('is_active', true)
      .order('kind')
      .order('display_name'),
  ) as {
    id: string;
    kind: 'admin' | 'branch';
    display_name: string;
    user_id: string | null;
    must_change_pin: boolean;
  }[];
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    label: row.display_name,
    hasPin: row.user_id !== null,
    onDefaultPin: row.must_change_pin,
  }));
}

export async function setAccountPin(accountId: string, pin: string): Promise<void> {
  unwrap(await supabase.rpc('admin_set_pin', { p_account_id: accountId, p_pin: pin }));
}

/** Back to the default PIN 1234; the account must choose a new PIN at its next sign-in. */
export async function resetAccountPin(accountId: string): Promise<void> {
  unwrap(await supabase.rpc('admin_reset_pin', { p_account_id: accountId }));
}

// ---------------------------------------------------------------------------------------------
// Staff (sales people per branch)
// ---------------------------------------------------------------------------------------------

/** Active branch codes, to check a staff sheet before it is uploaded. */
export async function listBranchCodes(): Promise<string[]> {
  const rows = unwrap(await supabase.from('branches').select('code').eq('is_active', true).order('code')) as {
    code: string;
  }[];
  return rows.map((row) => row.code);
}

/** The current staff in the staff-sheet layout: one row per person per active branch. */
export async function listStaffRows(): Promise<StaffRow[]> {
  const rows = unwrap(
    await supabase
      .from('employees')
      .select('odoo_name, employee_branches(is_active, branches(code, is_active))')
      .eq('is_active', true)
      .order('odoo_name'),
  ) as unknown as {
    odoo_name: string;
    employee_branches: { is_active: boolean; branches: { code: string; is_active: boolean } | null }[];
  }[];
  return rows.flatMap((row) => {
    const codes = row.employee_branches
      .filter((link) => link.is_active && link.branches?.is_active)
      .map((link) => link.branches!.code)
      .sort();
    // Someone without a branch is listed with an empty branch, so the admin can fill it in.
    return (codes.length > 0 ? codes : ['']).map((branch) => ({ name: row.odoo_name, branch, active: true }));
  });
}

export interface StaffUploadResult {
  readonly added: number;
  readonly left: number;
  readonly activeEmployees: number;
}

export async function uploadStaff(rows: readonly StaffRow[]): Promise<StaffUploadResult> {
  const result = unwrap(await supabase.rpc('admin_upsert_staff', { p_rows: rows })) as {
    added: number;
    left: number;
    active_employees: number;
  };
  return { added: result.added, left: result.left, activeEmployees: result.active_employees };
}

export interface BranchOption {
  readonly id: string;
  readonly code: string;
  readonly posName: string;
}

export async function listBranches(): Promise<BranchOption[]> {
  const rows = unwrap(
    await supabase.from('branches').select('id, code, pos_name').eq('is_active', true).order('code'),
  ) as { id: string; code: string; pos_name: string }[];
  return rows.map((row) => ({ id: row.id, code: row.code, posName: row.pos_name }));
}

/** Active sales people of one branch, by name. */
export async function listBranchStaff(branchId: string): Promise<{ id: string; name: string }[]> {
  const rows = unwrap(
    await supabase
      .from('employee_branches')
      .select('employees!inner(id, odoo_name, is_active)')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .eq('employees.is_active', true),
  ) as unknown as { employees: { id: string; odoo_name: string } }[];
  return rows
    .map((row) => ({ id: row.employees.id, name: row.employees.odoo_name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every active sales person's name, to suggest while typing. */
export async function listStaffNames(): Promise<string[]> {
  const rows = unwrap(
    await supabase.from('employees').select('odoo_name').eq('is_active', true).order('odoo_name'),
  ) as { odoo_name: string }[];
  return rows.map((row) => row.odoo_name);
}

/** Adds one sales person to a branch (created if new) or takes them off it. Other branches stay. */
export async function setStaffLink(name: string, branchId: string, active: boolean): Promise<void> {
  unwrap(await supabase.rpc('admin_set_staff_link', { p_name: name, p_branch_id: branchId, p_active: active }));
}
