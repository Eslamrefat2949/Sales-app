import { describe, expect, it } from 'vitest';
import { addUnit, applyOffer, createCart, removeUnit } from '../src/cart.ts';
import { DomainError } from '../src/errors.ts';
import { fromPounds, toPounds } from '../src/money.ts';
import type { Offer } from '../src/offer.ts';
import { createOfferApplication, previewOffer, priceCart, type CartUnit } from '../src/pricing.ts';

const SETTINGS = { defaultDiscountPercent: 30 };
const BUY4_PAY2: Offer = { id: 'offer-b4p2', code: 'B4P2', buyQty: 4, payQty: 2 };

/** [barcode, price after, discountable] → units in the order given. */
function units(...rows: [string, number, boolean?][]): CartUnit[] {
  return rows.map(([barcode, price, discountable = true], index) => {
    const [itemCode = barcode, size = 'M'] = barcode.split(/-(.*)/s);
    return {
      seq: index + 1,
      barcode,
      itemCode,
      size,
      listPrice: fromPounds(price),
      salePrice: fromPounds(price),
      discountable,
    };
  });
}

const pounds = (amount: number) => toPounds(amount);

describe('matches real cashier orders from Odoo (17 Nov 2026)', () => {
  it('Zaqaziq 12000577: one piece at 30%', () => {
    expect(pounds(priceCart(units(['R211452-L', 1999.99]), SETTINGS, null).totals.total)).toBe(1399.99);
  });

  it('Sharm El Sheikh 12000487: 30% summed first, total rounded once like Odoo', () => {
    const cart = priceCart(units(['R217175-S', 1499.99], ['R217120-M', 1199.99]), SETTINGS, null);
    expect(cart.units.map((unit) => pounds(unit.finalPrice))).toEqual([1049.99, 839.99]);
    expect(pounds(cart.totals.total)).toBe(1889.99); // not 1,889.98
    expect(pounds(cart.totals.defaultDiscountTotal)).toBe(809.99);
  });

  it('Mall of Arabia 12001556: buy 4 pay 2', () => {
    const cartUnits = units(
      ['R219822-L', 2299.99],
      ['R220123-M', 1999.99],
      ['R223077-28', 1799.99],
      ['R220243-M', 1699.99],
    );
    const cart = priceCart(cartUnits, SETTINGS, createOfferApplication(cartUnits, BUY4_PAY2));
    expect(cart.units.map((unit) => unit.discountPercent)).toEqual([0, 0, 100, 100]);
    expect(cart.units.map((unit) => pounds(unit.discountAmount))).toEqual([0, 0, 1799.99, 1699.99]);
    expect(pounds(cart.totals.total)).toBe(4299.98);
  });

  it('City Stars 12001104: accessory without discount stays out of the offer at full price', () => {
    const cartUnits = units(
      ['R220158-L', 1799.99],
      ['R216827-36', 1499.99],
      ['R215652-L', 1499.99],
      ['R212628-XL', 1199.99],
      ['O178475-One Size', 195, false],
    );
    const cart = priceCart(cartUnits, SETTINGS, createOfferApplication(cartUnits, BUY4_PAY2));
    expect(cart.units.map((unit) => unit.treatment)).toEqual([
      'offer_paid',
      'offer_paid',
      'offer_free',
      'offer_free',
      'no_discount',
    ]);
    expect(pounds(cart.totals.total)).toBe(3494.98);
  });
});

describe('items without discount', () => {
  it('are sold at the price after, with a 0% discount', () => {
    const cart = priceCart(units(['X1-One Size', 449.99, false]), SETTINGS, null);
    expect(cart.units[0]).toMatchObject({ treatment: 'no_discount', discountPercent: 0, discountAmount: 0 });
    expect(pounds(cart.totals.total)).toBe(449.99);
  });

  it('do not count towards the pieces the offer needs', () => {
    const cartUnits = units(['A1-M', 500], ['A2-M', 400], ['A3-M', 300], ['X1-M', 200, false]);
    expect(previewOffer(cartUnits, SETTINGS, BUY4_PAY2)).toEqual({ applicable: false, minUnits: 4 });
    expect(() => createOfferApplication(cartUnits, BUY4_PAY2)).toThrow(DomainError);
  });

  it('can be removed without cancelling the offer', () => {
    let cart = createCart();
    for (const unit of units(['A1-M', 500], ['A2-M', 400], ['X1-M', 200, false], ['A3-M', 300], ['A4-M', 250])) {
      const { seq: _seq, ...input } = unit;
      cart = addUnit(cart, input);
    }
    cart = applyOffer(cart, BUY4_PAY2);
    cart = removeUnit(cart, 3);
    expect(cart.offer).not.toBeNull();
    expect(pounds(priceCart(cart.units, SETTINGS, cart.offer).totals.total)).toBe(900);
  });
});
