import type { Money, Offer, PaymentMethod } from '@ravin-sales/domain';
import { normalizeBarcode } from '@ravin-sales/domain';
import { idbGet, idbSet } from '../lib/idb.ts';
import { supabase, unwrap } from '../lib/supabase.ts';

export type Localized = { readonly ar: string; readonly en: string };

export interface BranchPaymentMethod extends PaymentMethod {
  /** `code` is the payment method id; `journal` is exported to Odoo as payment_method. */
  readonly label: Localized;
  readonly journal: string;
}

export interface Employee {
  readonly id: string;
  /** Exactly as in Odoo, e.g. "9173-HABIBA MOHAMED SEDAY ELSAIED". */
  readonly name: string;
  readonly inBranch: boolean;
}

export interface AppConfig {
  readonly account: { readonly id: string; readonly kind: 'admin' | 'branch'; readonly label: string };
  readonly branch: { readonly id: string; readonly code: string; readonly posName: string } | null;
  readonly defaultDiscountPercent: number;
  readonly offer: (Offer & { readonly name: string }) | null;
  readonly paymentMethods: readonly BranchPaymentMethod[];
  readonly employees: readonly Employee[];
  readonly catalogVersion: string;
}

export interface CatalogVariant {
  readonly size: string;
  /** Exactly as in Odoo (exported as product_barcode). */
  readonly barcode: string;
  readonly listPrice: Money;
  readonly salePrice: Money;
  readonly discountable: boolean;
}

export interface CatalogItem {
  readonly itemCode: string;
  readonly name: string;
  readonly variants: readonly CatalogVariant[];
}

export interface Catalog {
  readonly items: readonly CatalogItem[];
  readonly byCode: ReadonlyMap<string, CatalogItem>;
  readonly byBarcode: ReadonlyMap<string, { readonly item: CatalogItem; readonly variant: CatalogVariant }>;
  readonly version: string;
}

interface BootstrapRow {
  account: { id: string; kind: 'admin' | 'branch'; label: string };
  branch: { id: string; code: string; pos_name: string } | null;
  default_discount_percent: number;
  offer: { id: string; code: string; name: string; buy_qty: number; pay_qty: number } | null;
  payment_methods: { id: string; name: string; name_ar: string | null; kind: PaymentMethod['kind']; journal: string }[];
  employees: { id: string; name: string; in_branch: boolean }[];
  catalog_version: string;
}

/** [barcode, item_code, size, list_price, sale_price, discountable, name] */
type CatalogRow = [string, string, string, number, number, boolean, string | null];

function toConfig(row: BootstrapRow): AppConfig {
  return {
    account: row.account,
    branch: row.branch ? { id: row.branch.id, code: row.branch.code, posName: row.branch.pos_name } : null,
    defaultDiscountPercent: Number(row.default_discount_percent),
    offer: row.offer
      ? {
          id: row.offer.id,
          code: row.offer.code,
          name: row.offer.name,
          buyQty: row.offer.buy_qty,
          payQty: row.offer.pay_qty,
        }
      : null,
    paymentMethods: row.payment_methods.map((method) => ({
      code: method.id,
      kind: method.kind,
      label: { ar: method.name_ar ?? method.name, en: method.name },
      journal: method.journal,
    })),
    employees: row.employees.map((employee) => ({
      id: employee.id,
      name: employee.name,
      inBranch: employee.in_branch,
    })),
    catalogVersion: row.catalog_version,
  };
}

function buildCatalog(rows: readonly CatalogRow[], version: string): Catalog {
  const byCode = new Map<string, { itemCode: string; name: string; variants: CatalogVariant[] }>();
  for (const [barcode, itemCode, size, listPrice, salePrice, discountable, name] of rows) {
    let item = byCode.get(itemCode);
    if (!item) {
      item = { itemCode, name: name ?? '', variants: [] };
      byCode.set(itemCode, item);
    }
    item.variants.push({ size, barcode, listPrice, salePrice, discountable });
  }
  const byBarcode = new Map<string, { item: CatalogItem; variant: CatalogVariant }>();
  for (const item of byCode.values()) {
    for (const variant of item.variants) byBarcode.set(normalizeBarcode(variant.barcode), { item, variant });
  }
  return { items: [...byCode.values()], byCode, byBarcode, version };
}

export interface LoadedData {
  readonly config: AppConfig;
  readonly catalog: Catalog;
  /** True when the phone had no connection and used what it saved last time. */
  readonly offline: boolean;
}

/**
 * Loads everything the app needs. Online: fresh settings, and the catalog only when it changed.
 * Offline: the copy saved on the phone, so selling never stops.
 */
export async function loadAppData(
  userId: string,
  onProgress: (step: 'settings' | 'catalog') => void,
): Promise<LoadedData> {
  const configKey = `config:${userId}`;
  onProgress('settings');
  let config: AppConfig;
  let offline = false;
  try {
    config = toConfig(unwrap(await supabase.rpc('app_bootstrap')) as BootstrapRow);
    await idbSet(configKey, config);
  } catch (error) {
    const saved = await idbGet<AppConfig>(configKey);
    if (!saved) throw error;
    config = saved;
    offline = true;
  }

  const saved = await idbGet<{ version: string; rows: CatalogRow[] }>('catalog');
  if (saved && (offline || saved.version === config.catalogVersion)) {
    return { config, catalog: buildCatalog(saved.rows, saved.version), offline };
  }
  onProgress('catalog');
  try {
    const rows = unwrap(await supabase.rpc('catalog_snapshot')) as CatalogRow[];
    await idbSet('catalog', { version: config.catalogVersion, rows });
    return { config, catalog: buildCatalog(rows, config.catalogVersion), offline };
  } catch (error) {
    if (saved) return { config, catalog: buildCatalog(saved.rows, saved.version), offline: true };
    throw error;
  }
}
