import { DomainError } from './errors.ts';
import type { Offer } from './offer.ts';
import { assertValidUnits, createOfferApplication, type CartUnit, type OfferApplication } from './pricing.ts';

/** Immutable cart state. Every operation returns a new state, which makes it easy to persist offline. */
export interface CartState {
  readonly units: readonly CartUnit[];
  /** Next seq to assign. Only ever increases, so a removed seq is never reused. */
  readonly nextSeq: number;
  readonly offer: OfferApplication | null;
}

export type NewCartUnit = Omit<CartUnit, 'seq'>;

export function createCart(): CartState {
  return { units: [], nextSeq: 1, offer: null };
}

export function addUnit(cart: CartState, input: NewCartUnit): CartState {
  const unit: CartUnit = { ...input, seq: cart.nextSeq };
  assertValidUnits([unit]);
  return { ...cart, units: [...cart.units, unit], nextSeq: cart.nextSeq + 1 };
}

/**
 * Removes one unit. If the unit was part of an active offer, the offer is cancelled and the whole
 * cart returns to the default discount until the seller applies the offer again. This stops anyone
 * removing a paid piece while keeping the free ones.
 */
export function removeUnit(cart: CartState, seq: number): CartState {
  const removed = cart.units.find((unit) => unit.seq === seq);
  if (!removed) {
    throw new DomainError('UNIT_NOT_FOUND', `no unit with seq ${seq} in the cart`);
  }
  const touchesOffer = cart.offer !== null && removed.discountable && seq <= cart.offer.appliedAtSeq;
  return {
    ...cart,
    units: cart.units.filter((unit) => unit.seq !== seq),
    offer: touchesOffer ? null : cart.offer,
  };
}

/** Applies (or re-applies) an offer to everything currently in the cart. */
export function applyOffer(cart: CartState, offer: Offer): CartState {
  return { ...cart, offer: createOfferApplication(cart.units, offer) };
}

export function removeOffer(cart: CartState): CartState {
  return { ...cart, offer: null };
}
