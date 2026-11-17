import { fromPounds, type Money } from './money.ts';
import { normalizeBarcode } from './scan.ts';

/** One row of the Odoo item list export (Product Variant), as read from Excel. */
export interface CatalogSourceRow {
  /** "Internal Reference": the barcode on the tag, e.g. R219822-L or O178475-One Size. */
  readonly reference: unknown;
  readonly size: unknown;
  /** "Original Sales Price (MSRP)": price before. */
  readonly listPrice: unknown;
  /** "Sales Price": price after, the price on the system. */
  readonly salePrice: unknown;
  readonly name?: unknown;
}

export interface CatalogProduct {
  readonly barcode: string;
  readonly itemCode: string;
  readonly size: string;
  readonly name: string | null;
  readonly listPrice: Money;
  readonly salePrice: Money;
}

export interface CatalogImport {
  readonly products: readonly CatalogProduct[];
  /** Rows left out, with the reason, for the admin's report. */
  readonly skipped: {
    readonly noPrice: readonly string[];
    /** The same barcode on more than one row: ambiguous, so none of them is sold until fixed in Odoo. */
    readonly duplicateBarcode: readonly string[];
    readonly invalid: readonly string[];
  };
}

const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value).trim());

function price(value: unknown): Money | null {
  const number = typeof value === 'number' ? value : Number(text(value).replace(/,/g, ''));
  return Number.isFinite(number) && number >= 0 ? fromPounds(number) : null;
}

/** Item code is the reference before the first dash ("R219822-L" → "R219822"), or the whole reference. */
export function itemCodeOf(reference: string): string {
  const dash = reference.indexOf('-');
  return dash > 0 ? reference.slice(0, dash) : reference;
}

/**
 * Turns the Odoo item list into sellable products. Keeps barcodes exactly as in Odoo (they are
 * exported back as product_barcode). Leaves out rows without a price and every row of a barcode
 * that appears more than once (also when it differs only by case or spaces).
 */
export function prepareCatalogImport(rows: readonly CatalogSourceRow[]): CatalogImport {
  const byKey = new Map<string, CatalogProduct[]>();
  const noPrice: string[] = [];
  const invalid: string[] = [];

  for (const row of rows) {
    const barcode = text(row.reference);
    const listPrice = price(row.listPrice);
    const salePrice = price(row.salePrice);
    if (barcode === '' || listPrice === null || salePrice === null) {
      invalid.push(barcode || '(empty)');
      continue;
    }
    if (salePrice === 0) {
      noPrice.push(barcode);
      continue;
    }
    const size = text(row.size) || barcode.slice(itemCodeOf(barcode).length + 1) || '-';
    const product: CatalogProduct = {
      barcode,
      itemCode: itemCodeOf(barcode),
      size,
      name: text(row.name) || null,
      listPrice: Math.max(listPrice, salePrice),
      salePrice,
    };
    const key = normalizeBarcode(barcode);
    const group = byKey.get(key);
    if (group) group.push(product);
    else byKey.set(key, [product]);
  }

  const products: CatalogProduct[] = [];
  const duplicateBarcode: string[] = [];
  for (const group of byKey.values()) {
    if (group.length === 1) products.push(group[0]!);
    else duplicateBarcode.push(...new Set(group.map((product) => product.barcode)));
  }
  return { products, skipped: { noPrice, duplicateBarcode, invalid } };
}

/** Header names in the Odoo export, compared case-insensitively with any kind of spacing. */
const HEADERS: Readonly<Record<keyof CatalogSourceRow, readonly string[]>> = {
  reference: ['internal reference', 'barcode', 'reference'],
  size: ['size'],
  listPrice: ['original sales price (msrp)', 'msrp', 'price before', 'list price'],
  salePrice: ['sales price', 'price after', 'sale price'],
  name: ['name', 'product', 'product name', 'display name'],
};

const normalizeHeader = (value: unknown) => text(value).replace(/\s+/g, ' ').toLowerCase();

export type ItemListColumns = { readonly [K in keyof CatalogSourceRow]-?: number };

/** Finds the columns of the item list by their headers. Returns the missing ones if any required header is absent. */
export function findItemListColumns(header: readonly unknown[]): ItemListColumns | { readonly missing: string[] } {
  const names = header.map(normalizeHeader);
  const find = (key: keyof CatalogSourceRow) => names.findIndex((name) => HEADERS[key].includes(name));
  const columns = {
    reference: find('reference'),
    size: find('size'),
    listPrice: find('listPrice'),
    salePrice: find('salePrice'),
    name: find('name'),
  };
  const missing = (['reference', 'size', 'listPrice', 'salePrice'] as const)
    .filter((key) => columns[key] < 0)
    .map((key) => HEADERS[key][0]!);
  return missing.length > 0 ? { missing } : columns;
}

/** Reads the data rows of the item list (everything after the header row). */
export function readItemListRows(rows: readonly (readonly unknown[])[], columns: ItemListColumns): CatalogSourceRow[] {
  return rows.slice(1).map((row) => ({
    reference: row[columns.reference],
    size: row[columns.size],
    listPrice: row[columns.listPrice],
    salePrice: row[columns.salePrice],
    name: columns.name >= 0 ? row[columns.name] : undefined,
  }));
}
