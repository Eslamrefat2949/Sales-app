import { DomainError } from './errors.ts';
import { applyDiscount, assertMoney, assertPercent, type Money } from './money.ts';
import { allocateOffer, assertValidOffer, type Offer } from './offer.ts';

/** One physical piece in the cart. Two pieces of the same item and size are two units. */
export interface CartUnit {
  /** Position in the cart: 1, 2, 3... assigned when added and never reused. */
  readonly seq: number;
  readonly itemCode: string;
  readonly size: string;
  /** Original price ("before"). */
  readonly listPrice: Money;
  /** Sale price ("after"). Every discount is calculated from this price. */
  readonly salePrice: Money;
}

export interface PricingSettings {
  /** Extra discount applied on the sale price of every unit that is not in an offer (currently 30). */
  readonly defaultDiscountPercent: number;
}

/**
 * Records that the seller activated an offer.
 * Only units that were already in the cart (seq <= appliedAtSeq) take part in the offer;
 * units added afterwards get the default discount and never reshuffle the offer.
 */
export interface OfferApplication {
  /** Snapshot, so later edits to the offer definition never change a past invoice. */
  readonly offer: Offer;
  readonly appliedAtSeq: number;
  /** Number of units in the cart at activation; used to detect removed units. */
  readonly unitCountAtApply: number;
}

export type UnitTreatment = 'default_discount' | 'offer_paid' | 'offer_free';

export interface PricedUnit extends CartUnit {
  readonly treatment: UnitTreatment;
  /** Discount percent applied on top of the sale price (30, 0 or 100). */
  readonly discountPercent: number;
  readonly finalPrice: Money;
}

export interface CartTotals {
  readonly unitCount: number;
  readonly listTotal: Money;
  readonly saleTotal: Money;
  readonly defaultDiscountTotal: Money;
  readonly offerDiscountTotal: Money;
  /** Amount the customer pays: saleTotal - defaultDiscountTotal - offerDiscountTotal. */
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
    if (unit.itemCode.trim() === '' || unit.size.trim() === '') {
      throw new DomainError('INVALID_UNIT', `unit ${unit.seq} must have an item code and a size`);
    }
    assertMoney(unit.listPrice, `listPrice of unit ${unit.seq}`);
    assertMoney(unit.salePrice, `salePrice of unit ${unit.seq}`);
  }
}

function assertValidSettings(settings: PricingSettings): void {
  assertPercent(settings.defaultDiscountPercent, 'defaultDiscountPercent');
}

/** Activates an offer on everything currently in the cart. Throws if the cart is too small. */
export function createOfferApplication(units: readonly CartUnit[], offer: Offer): OfferApplication {
  assertValidOffer(offer);
  assertValidUnits(units);
  if (units.length < offer.buyQty) {
    throw new DomainError(
      'OFFER_NOT_APPLICABLE',
      `offer ${offer.code} needs at least ${offer.buyQty} units, cart has ${units.length}`,
    );
  }
  return {
    offer: { ...offer },
    appliedAtSeq: Math.max(...units.map((unit) => unit.seq)),
    unitCountAtApply: units.length,
  };
}

function resolveOfferTreatments(units: readonly CartUnit[], application: OfferApplication): Map<number, UnitTreatment> {
  assertValidOffer(application.offer);
  const inScope = units.filter((unit) => unit.seq <= application.appliedAtSeq);
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

function priceUnit(unit: CartUnit, treatment: UnitTreatment, defaultDiscountPercent: number): PricedUnit {
  switch (treatment) {
    case 'offer_paid':
      return { ...unit, treatment, discountPercent: 0, finalPrice: unit.salePrice };
    case 'offer_free':
      return { ...unit, treatment, discountPercent: 100, finalPrice: 0 };
    case 'default_discount':
      return {
        ...unit,
        treatment,
        discountPercent: defaultDiscountPercent,
        finalPrice: applyDiscount(unit.salePrice, defaultDiscountPercent),
      };
  }
}

function computeTotals(units: readonly PricedUnit[]): CartTotals {
  let listTotal = 0;
  let saleTotal = 0;
  let defaultDiscountTotal = 0;
  let offerDiscountTotal = 0;
  let total = 0;
  for (const unit of units) {
    listTotal += unit.listPrice;
    saleTotal += unit.salePrice;
    total += unit.finalPrice;
    const discount = unit.salePrice - unit.finalPrice;
    if (unit.treatment === 'default_discount') defaultDiscountTotal += discount;
    else offerDiscountTotal += discount;
  }
  return { unitCount: units.length, listTotal, saleTotal, defaultDiscountTotal, offerDiscountTotal, total };
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
  const treatments = offer ? resolveOfferTreatments(units, offer) : new Map<number, UnitTreatment>();
  const priced = [...units]
    .sort((a, b) => a.seq - b.seq)
    .map((unit) => priceUnit(unit, treatments.get(unit.seq) ?? 'default_discount', settings.defaultDiscountPercent));
  return { units: priced, totals: computeTotals(priced), offer };
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
  if (units.length < offer.buyQty) return { applicable: false, minUnits: offer.buyQty };
  const withoutOffer = priceCart(units, settings, null).totals.total;
  const withOffer = priceCart(units, settings, createOfferApplication(units, offer)).totals.total;
  return { applicable: true, withOffer, withoutOffer, customerSaving: withoutOffer - withOffer };
}
