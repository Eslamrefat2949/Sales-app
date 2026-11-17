import { DomainError } from './errors.ts';
import { assertMoney, assertPercent, discountedExact, roundExact, type Money } from './money.ts';
import { allocateOffer, assertValidOffer, type Offer } from './offer.ts';

/** One physical piece in the cart. Two pieces of the same item and size are two units. */
export interface CartUnit {
  /** Position in the cart: 1, 2, 3... assigned when added and never reused. */
  readonly seq: number;
  /** Barcode exactly as in Odoo (e.g. "O178475-One Size"); used in the Odoo export. */
  readonly barcode: string;
  readonly itemCode: string;
  readonly size: string;
  /** Original price ("before"), shown for reference. */
  readonly listPrice: Money;
  /** Price on the system ("after"), Odoo's price_unit. Every discount is calculated from this price. */
  readonly salePrice: Money;
  /** False for items the admin excluded from discounts: sold at the sale price and kept out of offers. */
  readonly discountable: boolean;
}

export interface PricingSettings {
  /** Extra discount applied on the sale price of every unit that is not in an offer (currently 30). */
  readonly defaultDiscountPercent: number;
}

/**
 * Records that the seller activated an offer.
 * Only discountable units that were already in the cart (seq <= appliedAtSeq) take part in the offer;
 * units added afterwards get the default discount and never reshuffle the offer.
 */
export interface OfferApplication {
  /** Snapshot, so later edits to the offer definition never change a past invoice. */
  readonly offer: Offer;
  readonly appliedAtSeq: number;
  /** Discountable units in the cart at activation; used to detect removed units. */
  readonly unitCountAtApply: number;
}

export type UnitTreatment = 'default_discount' | 'offer_paid' | 'offer_free' | 'no_discount';

export interface PricedUnit extends CartUnit {
  readonly treatment: UnitTreatment;
  /** Discount percent on the sale price: 30 (default), 0 (offer paid, no discount) or 100 (free). */
  readonly discountPercent: number;
  /** Discount on this piece, rounded to the piaster (for display and the Odoo discount amount column). */
  readonly discountAmount: Money;
  /** Price of this piece after discount, rounded to the piaster (for display). */
  readonly finalPrice: Money;
}

export interface CartTotals {
  readonly unitCount: number;
  readonly listTotal: Money;
  readonly saleTotal: Money;
  readonly defaultDiscountTotal: Money;
  readonly offerDiscountTotal: Money;
  /**
   * Amount the customer pays: saleTotal - defaultDiscountTotal - offerDiscountTotal.
   * Like Odoo, line discounts are summed exactly and the total is rounded once, so it can differ by a
   * piaster from the sum of the rounded piece prices (1,499.99 + 1,199.99 at 30% = 1,889.99).
   */
  readonly total: Money;
}

export interface PricedCart {
  /** Units in the order they were added. */
  readonly units: readonly PricedUnit[];
  readonly totals: CartTotals;
  readonly offer: OfferApplication | null;
}

export function assertValidUnits(units: readonly CartUnit[]): void {
  const seen = new Set<number>();
  for (const unit of units) {
    if (!Number.isSafeInteger(unit.seq) || unit.seq < 1 || seen.has(unit.seq)) {
      throw new DomainError('INVALID_UNIT', `unit seq must be a unique positive integer, got ${unit.seq}`);
    }
    seen.add(unit.seq);
    if (unit.itemCode.trim() === '' || unit.size.trim() === '' || unit.barcode.trim() === '') {
      throw new DomainError('INVALID_UNIT', `unit ${unit.seq} must have a barcode, an item code and a size`);
    }
    if (typeof unit.discountable !== 'boolean') {
      throw new DomainError('INVALID_UNIT', `unit ${unit.seq} must say whether it takes discounts`);
    }
    assertMoney(unit.listPrice, `listPrice of unit ${unit.seq}`);
    assertMoney(unit.salePrice, `salePrice of unit ${unit.seq}`);
  }
}

function assertValidSettings(settings: PricingSettings): void {
  assertPercent(settings.defaultDiscountPercent, 'defaultDiscountPercent');
}

const discountableOnly = (units: readonly CartUnit[]) => units.filter((unit) => unit.discountable);

/** Activates an offer on everything currently in the cart. Throws if there are too few discountable pieces. */
export function createOfferApplication(units: readonly CartUnit[], offer: Offer): OfferApplication {
  assertValidOffer(offer);
  assertValidUnits(units);
  const eligible = discountableOnly(units);
  if (eligible.length < offer.buyQty) {
    throw new DomainError(
      'OFFER_NOT_APPLICABLE',
      `offer ${offer.code} needs at least ${offer.buyQty} discountable units, cart has ${eligible.length}`,
    );
  }
  return {
    offer: { ...offer },
    appliedAtSeq: Math.max(...units.map((unit) => unit.seq)),
    unitCountAtApply: eligible.length,
  };
}

function resolveOfferTreatments(units: readonly CartUnit[], application: OfferApplication): Map<number, UnitTreatment> {
  assertValidOffer(application.offer);
  const inScope = discountableOnly(units).filter((unit) => unit.seq <= application.appliedAtSeq);
  if (application.unitCountAtApply < application.offer.buyQty || inScope.length !== application.unitCountAtApply) {
    throw new DomainError(
      'OFFER_INTEGRITY',
      `offer ${application.offer.code} was applied to ${application.unitCountAtApply} units but ${inScope.length} remain in scope`,
    );
  }
  const allocation = allocateOffer(inScope, application.offer);
  const treatments = new Map<number, UnitTreatment>();
  for (const unit of allocation.paid) treatments.set(unit.seq, 'offer_paid');
  for (const unit of allocation.free) treatments.set(unit.seq, 'offer_free');
  return treatments;
}

function treatmentOf(unit: CartUnit, offerTreatments: Map<number, UnitTreatment>): UnitTreatment {
  if (!unit.discountable) return 'no_discount';
  return offerTreatments.get(unit.seq) ?? 'default_discount';
}

interface ExactUnit {
  readonly unit: PricedUnit;
  /** Price after discount in 1/10,000 piaster, before rounding. */
  readonly exact: number;
}

function priceUnit(unit: CartUnit, treatment: UnitTreatment, defaultDiscountPercent: number): ExactUnit {
  const discountPercent =
    treatment === 'default_discount' ? defaultDiscountPercent : treatment === 'offer_free' ? 100 : 0;
  const exact = discountedExact(unit.salePrice, discountPercent);
  const finalPrice = roundExact(exact);
  return {
    unit: { ...unit, treatment, discountPercent, finalPrice, discountAmount: unit.salePrice - finalPrice },
    exact,
  };
}

function computeTotals(priced: readonly ExactUnit[]): CartTotals {
  let listTotal = 0;
  let saleTotal = 0;
  let offerDiscountTotal = 0;
  let exactTotal = 0;
  for (const { unit, exact } of priced) {
    listTotal += unit.listPrice;
    saleTotal += unit.salePrice;
    exactTotal += exact;
    if (unit.treatment === 'offer_free') offerDiscountTotal += unit.salePrice;
  }
  const total = roundExact(exactTotal);
  return {
    unitCount: priced.length,
    listTotal,
    saleTotal,
    defaultDiscountTotal: saleTotal - offerDiscountTotal - total,
    offerDiscountTotal,
    total,
  };
}

/**
 * Prices a cart. Pure and deterministic: the device uses it for instant display and the server
 * re-runs it on every synced invoice to verify the totals.
 */
export function priceCart(
  units: readonly CartUnit[],
  settings: PricingSettings,
  offer: OfferApplication | null,
): PricedCart {
  assertValidSettings(settings);
  assertValidUnits(units);
  const offerTreatments = offer ? resolveOfferTreatments(units, offer) : new Map<number, UnitTreatment>();
  const priced = [...units]
    .sort((a, b) => a.seq - b.seq)
    .map((unit) => priceUnit(unit, treatmentOf(unit, offerTreatments), settings.defaultDiscountPercent));
  return { units: priced.map(({ unit }) => unit), totals: computeTotals(priced), offer };
}

export type OfferPreview =
  | { readonly applicable: false; readonly minUnits: number }
  | {
      readonly applicable: true;
      readonly withOffer: Money;
      readonly withoutOffer: Money;
      /** Positive: the offer saves the customer money. Negative: the default discount is cheaper. */
      readonly customerSaving: number;
    };

/**
 * Shows the seller both totals before activating an offer, because with "pay at sale price"
 * the offer can cost the customer more than the default discount (e.g. 1000, 900, 150, 150).
 */
export function previewOffer(units: readonly CartUnit[], settings: PricingSettings, offer: Offer): OfferPreview {
  assertValidOffer(offer);
  if (discountableOnly(units).length < offer.buyQty) return { applicable: false, minUnits: offer.buyQty };
  const withoutOffer = priceCart(units, settings, null).totals.total;
  const withOffer = priceCart(units, settings, createOfferApplication(units, offer)).totals.total;
  return { applicable: true, withOffer, withoutOffer, customerSaving: withoutOffer - withOffer };
}
