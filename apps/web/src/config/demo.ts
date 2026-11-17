import {
  defaultBarcode,
  fromPounds,
  normalizeBarcode,
  type Money,
  type Offer,
  type PaymentMethod,
  type PricingSettings,
} from '@ravin-sales/domain';

/**
 * Demo configuration. In production these come from Supabase: the item list uploaded from Odoo,
 * the branch mapping, the employees list and each branch's payment methods.
 */

export interface CatalogVariant {
  readonly size: string;
  /** Exact barcode on the tag; defaults to ITEMCODE-SIZE when the item list has none. */
  readonly barcode: string;
  readonly listPrice: Money;
  readonly salePrice: Money;
}

export interface CatalogItem {
  readonly itemCode: string;
  readonly name: string;
  readonly variants: readonly CatalogVariant[];
}

export interface Employee {
  readonly id: string;
  readonly name: string;
}

export type Localized = { readonly ar: string; readonly en: string };

export interface BranchPaymentMethod extends PaymentMethod {
  readonly label: Localized;
}

export const BRANCH = { code: 'ABC', name: { ar: 'فرع تجريبي', en: 'Demo branch' } as Localized };
export const DEVICE_NO = 1;

export const PRICING: PricingSettings = { defaultDiscountPercent: 30 };
export const ACTIVE_OFFER: Offer = { id: 'offer-b4p2', code: 'B4P2', buyQty: 4, payQty: 2 };

export const EMPLOYEES: readonly Employee[] = [
  { id: 'emp-101', name: 'Ahmed Samir' },
  { id: 'emp-102', name: 'Mona Adel' },
  { id: 'emp-103', name: 'Youssef Hany' },
  { id: 'emp-104', name: 'Nour Khaled' },
];

export const PAYMENT_METHODS: readonly BranchPaymentMethod[] = [
  { code: 'CASH', kind: 'cash', label: { ar: 'كاش', en: 'Cash' } },
  { code: 'VISA', kind: 'card', label: { ar: 'فيزا', en: 'Visa' } },
  { code: 'INSTAPAY', kind: 'other', label: { ar: 'إنستاباي', en: 'InstaPay' } },
];

const LETTERS = ['XS', 'S', 'M', 'L', 'XL'];
const WAIST = ['28', '30', '32', '34', '36'];
const EU = ['36', '38', '40', '42', '44'];
const KIDS = ['2-3Y', '4-5Y', '6-7Y', '8-9Y'];
const SHOES = ['38', '39', '40', '41', '42', '43'];

// [item code, name, price before, price after, sizes]
const ROWS: readonly (readonly [string, string, number, number, readonly string[]])[] = [
  ['A10234', 'Linen Shirt', 1299, 899, LETTERS],
  ['A10235', 'Oxford Shirt', 1199, 799, LETTERS],
  ['A10412', 'Oversized Tee', 599, 399, LETTERS],
  ['A10413', 'Graphic Tee', 649, 449, LETTERS],
  ['A10520', 'Ribbed Tank Top', 399, 249, LETTERS],
  ['A10633', 'Satin Blouse', 1099, 749, LETTERS],
  ['A10718', 'Knit Polo', 999, 699, LETTERS],
  ['A10805', 'Cropped Hoodie', 1399, 949, LETTERS],
  ['A10806', 'Zip Hoodie', 1499, 999, LETTERS],
  ['B20114', 'Wide Leg Jeans', 1599, 1099, WAIST],
  ['B20115', 'Straight Jeans', 1499, 999, WAIST],
  ['B20230', 'Pleated Trousers', 1399, 899, EU],
  ['B20341', 'Cargo Pants', 1299, 849, LETTERS],
  ['B20452', 'Denim Shorts', 899, 599, WAIST],
  ['B20563', 'Midi Skirt', 999, 649, LETTERS],
  ['C30107', 'Denim Jacket', 2199, 1499, LETTERS],
  ['C30218', 'Puffer Jacket', 2999, 1999, LETTERS],
  ['C30329', 'Wool Blazer', 2799, 1899, EU],
  ['C30430', 'Trench Coat', 3299, 2299, LETTERS],
  ['D40111', 'Wrap Dress', 1699, 1149, LETTERS],
  ['D40222', 'Maxi Dress', 1899, 1299, LETTERS],
  ['D40333', 'Shirt Dress', 1499, 999, LETTERS],
  ['K50101', 'Kids Hoodie', 799, 549, KIDS],
  ['K50202', 'Kids Jeans', 699, 479, KIDS],
  ['K50303', 'Kids Tee', 349, 229, KIDS],
  ['S60110', 'Leather Sneakers', 2499, 1699, SHOES],
  ['S60221', 'Canvas Sneakers', 1299, 899, SHOES],
  ['S60332', 'Ankle Boots', 2899, 1999, SHOES],
  ['X70101', 'Leather Belt', 599, 399, ['S', 'M', 'L']],
  ['X70202', 'Canvas Tote', 499, 349, ['ONE SIZE']],
];

export const CATALOG: readonly CatalogItem[] = ROWS.map(([itemCode, name, before, after, sizes]) => ({
  itemCode,
  name,
  variants: sizes.map((size) => ({
    size,
    barcode: defaultBarcode(itemCode, size),
    listPrice: fromPounds(before),
    salePrice: fromPounds(after),
  })),
}));

export const CATALOG_BY_CODE: ReadonlyMap<string, CatalogItem> = new Map(CATALOG.map((item) => [item.itemCode, item]));

export interface BarcodeMatch {
  readonly item: CatalogItem;
  readonly variant: CatalogVariant;
}

/** Exact barcode lookup, built once. Works offline because the catalog lives on the phone. */
export const BARCODE_INDEX: ReadonlyMap<string, BarcodeMatch> = new Map(
  CATALOG.flatMap((item) =>
    item.variants.map((variant) => [normalizeBarcode(variant.barcode), { item, variant }] as const),
  ),
);
