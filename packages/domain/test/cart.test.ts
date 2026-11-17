import { describe, expect, it } from 'vitest';
import { addUnit, applyOffer, createCart, removeOffer, removeUnit, type CartState } from '../src/cart.ts';
import { DomainError } from '../src/errors.ts';
import { fromPounds, toPounds } from '../src/money.ts';
import type { Offer } from '../src/offer.ts';
import { priceCart } from '../src/pricing.ts';

const SETTINGS = { defaultDiscountPercent: 30 };
const BUY4_PAY2: Offer = { id: 'offer-b4p2', code: 'B4P2', buyQty: 4, payQty: 2 };

function add(cart: CartState, ...salePrices: number[]): CartState {
  return salePrices.reduce(
    (state, price, index) =>
      addUnit(state, {
        barcode: `A${price}${index}-M`,
        discountable: true,
        itemCode: `A${price}${index}`,
        size: 'M',
        listPrice: fromPounds(price * 2),
        salePrice: fromPounds(price),
      }),
    cart,
  );
}

const total = (cart: CartState): number => toPounds(priceCart(cart.units, SETTINGS, cart.offer).totals.total);

describe('cart', () => {
  it('assigns increasing seq numbers', () => {
    const cart = add(createCart(), 100, 200, 300);
    expect(cart.units.map((unit) => unit.seq)).toEqual([1, 2, 3]);
    expect(cart.nextSeq).toBe(4);
  });

  it('never reuses a seq after a removal', () => {
    const cart = add(removeUnit(add(createCart(), 100, 200), 2), 300);
    expect(cart.units.map((unit) => unit.seq)).toEqual([1, 3]);
  });

  it('applies the offer to the current pieces', () => {
    const cart = applyOffer(add(createCart(), 1000, 800, 600, 400, 300), BUY4_PAY2);
    expect(total(cart)).toBe(2010);
  });

  it('keeps the offer when a piece added after it is removed', () => {
    let cart = applyOffer(add(createCart(), 1000, 800, 600, 400), BUY4_PAY2);
    cart = add(cart, 300);
    cart = removeUnit(cart, 5);
    expect(cart.offer).not.toBeNull();
    expect(total(cart)).toBe(1800);
  });

  it('cancels the offer when one of its pieces is removed', () => {
    let cart = applyOffer(add(createCart(), 1000, 800, 600, 400, 300), BUY4_PAY2);
    cart = removeUnit(cart, 1);
    expect(cart.offer).toBeNull();
    expect(total(cart)).toBe(1470); // (800 + 600 + 400 + 300) at 30%
  });

  it('re-applying the offer includes pieces added later', () => {
    let cart = applyOffer(add(createCart(), 100, 90, 80, 70, 60), BUY4_PAY2);
    cart = add(cart, 50, 40, 30);
    expect(total(cart)).toBe(100 + 90 + 42 + 35 + 28 + 21); // offer on first 5 only, rest 30%
    cart = applyOffer(cart, BUY4_PAY2);
    expect(total(cart)).toBe(100 + 90 + 80 + 70); // 8 pieces: 4 paid, 4 free
  });

  it('removes the offer on request', () => {
    const cart = removeOffer(applyOffer(add(createCart(), 1000, 800, 600, 400), BUY4_PAY2));
    expect(cart.offer).toBeNull();
    expect(total(cart)).toBe(1960);
  });

  it('refuses the offer on a cart that is too small', () => {
    expect(() => applyOffer(add(createCart(), 100, 100, 100), BUY4_PAY2)).toThrow(DomainError);
  });

  it('refuses to remove a piece that is not in the cart', () => {
    expect(() => removeUnit(createCart(), 1)).toThrow(DomainError);
  });
});
