import {
  addUnit,
  applyOffer,
  assertValidUnits,
  createCart,
  priceCart,
  removeOffer,
  removeUnit,
  type CartState,
  type NewCartUnit,
  type Offer,
  type PricedCart,
  type PricingSettings,
} from '@ravin-sales/domain';
import { useEffect, useMemo, useReducer } from 'react';
import { readJson, writeJson } from '../lib/storage.ts';

export type CartAction =
  | { readonly type: 'add'; readonly unit: NewCartUnit }
  | { readonly type: 'remove'; readonly seq: number }
  | { readonly type: 'applyOffer'; readonly offer: Offer }
  | { readonly type: 'removeOffer' }
  | { readonly type: 'clear' };

function reducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add':
      return addUnit(state, action.unit);
    case 'remove':
      return removeUnit(state, action.seq);
    case 'applyOffer':
      return applyOffer(state, action.offer);
    case 'removeOffer':
      return removeOffer(state);
    case 'clear':
      return createCart();
  }
}

/** Restores the cart after a reload so a sale in progress is never lost; discards anything invalid. */
function restore(key: string, pricing: PricingSettings): CartState {
  const saved = readJson<CartState | null>(key, null);
  if (!saved || !Array.isArray(saved.units) || typeof saved.nextSeq !== 'number') return createCart();
  try {
    assertValidUnits(saved.units);
    priceCart(saved.units, pricing, saved.offer ?? null);
    return { units: saved.units, nextSeq: saved.nextSeq, offer: saved.offer ?? null };
  } catch {
    return createCart();
  }
}

export function useCart(
  storageKey: string,
  pricing: PricingSettings,
): { cart: CartState; priced: PricedCart; dispatch: (action: CartAction) => void } {
  const [cart, dispatch] = useReducer(reducer, undefined, () => restore(storageKey, pricing));
  useEffect(() => writeJson(storageKey, cart), [storageKey, cart]);
  const priced = useMemo(() => priceCart(cart.units, pricing, cart.offer), [cart, pricing]);
  return { cart, priced, dispatch };
}
