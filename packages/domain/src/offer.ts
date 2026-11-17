import { DomainError } from './errors.ts';
import type { CartUnit } from './pricing.ts';

/**
 * A "buy X, pay Y" offer, e.g. buy 4 pay 2.
 * Applies to every item in the cart (no item/category scope by business decision).
 */
export interface Offer {
  readonly id: string;
  readonly code: string;
  readonly buyQty: number;
  readonly payQty: number;
}

export function assertValidOffer(offer: Offer): void {
  const { buyQty, payQty } = offer;
  if (!Number.isSafeInteger(buyQty) || !Number.isSafeInteger(payQty) || payQty < 1 || buyQty <= payQty) {
    throw new DomainError(
      'INVALID_OFFER',
      `offer ${offer.code} must satisfy 1 <= payQty < buyQty (integers), got buy ${buyQty} pay ${payQty}`,
    );
  }
}

export interface OfferAllocation {
  /** Most expensive units: charged at sale price. */
  readonly paid: readonly CartUnit[];
  /** Units given free. */
  readonly free: readonly CartUnit[];
  /** Cheapest units left over after the complete groups: they get the default discount. */
  readonly outside: readonly CartUnit[];
}

/** Most expensive first; equal prices keep the order they were added in, so results are deterministic. */
function byOfferPriority(a: CartUnit, b: CartUnit): number {
  return b.salePrice - a.salePrice || a.seq - b.seq;
}

/**
 * Splits units into paid / free / outside for a "buy X pay Y" offer.
 *
 * Units are sorted from most to least expensive. With `g = floor(count / buyQty)` complete groups,
 * the top `g * buyQty` units enter the offer: the top `g * payQty` of them are paid and the rest are free.
 * Remaining units (always the cheapest) stay outside the offer.
 *
 * Buy 4 pay 2 with 5 units: #1 #2 paid, #3 #4 free, #5 outside.
 * Buy 4 pay 2 with 8 units: #1..#4 paid, #5..#8 free.
 */
export function allocateOffer(units: readonly CartUnit[], offer: Offer): OfferAllocation {
  assertValidOffer(offer);
  const sorted = [...units].sort(byOfferPriority);
  const groups = Math.floor(sorted.length / offer.buyQty);
  const paidCount = groups * offer.payQty;
  const inOfferCount = groups * offer.buyQty;
  return {
    paid: sorted.slice(0, paidCount),
    free: sorted.slice(paidCount, inOfferCount),
    outside: sorted.slice(inOfferCount),
  };
}
