import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/errors.ts';
import { applyDiscount, fromPounds, toPounds } from '../src/money.ts';
import type { Offer } from '../src/offer.ts';
import {
  createOfferApplication,
  previewOffer,
  priceCart,
  type CartUnit,
  type PricedCart,
  type UnitTreatment,
} from '../src/pricing.ts';

const SETTINGS = { defaultDiscountPercent: 30 };
const BUY4_PAY2: Offer = { id: 'offer-b4p2', code: 'B4P2', buyQty: 4, payQty: 2 };

/** Builds units from sale prices in pounds; seq follows the order given. */
function units(...salePrices: number[]): CartUnit[] {
  return salePrices.map((price, index) => ({
    seq: index + 1,
    barcode: `A${1000 + index}-M`,
    itemCode: `A${1000 + index}`,
    size: 'M',
    discountable: true,
    listPrice: fromPounds(price * 2),
    salePrice: fromPounds(price),
  }));
}

const total = (cart: PricedCart): number => toPounds(cart.totals.total);
const treatments = (cart: PricedCart): UnitTreatment[] => cart.units.map((unit) => unit.treatment);
const finalPrices = (cart: PricedCart): number[] => cart.units.map((unit) => toPounds(unit.finalPrice));

function expectDomainError(fn: () => unknown, code: DomainError['code']): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected DomainError ${code}`);
}

function withOffer(cartUnits: CartUnit[], offer: Offer = BUY4_PAY2): PricedCart {
  return priceCart(cartUnits, SETTINGS, createOfferApplication(cartUnits, offer));
}

describe('default discount', () => {
  it('applies 30% on the sale price of every unit', () => {
    const cart = priceCart(units(1000, 800, 600, 400, 300), SETTINGS, null);
    expect(finalPrices(cart)).toEqual([700, 560, 420, 280, 210]);
    expect(total(cart)).toBe(2170);
    expect(treatments(cart).every((t) => t === 'default_discount')).toBe(true);
  });

  it('rounds half-up to the nearest piaster', () => {
    expect(applyDiscount(fromPounds(799), 30)).toBe(fromPounds(559.3));
    expect(applyDiscount(fromPounds(333.33), 30)).toBe(fromPounds(233.33));
    expect(applyDiscount(15, 30)).toBe(11); // 10.5 piasters -> 11
  });

  it('uses the configured percent', () => {
    const cart = priceCart(units(1000), { defaultDiscountPercent: 40 }, null);
    expect(total(cart)).toBe(600);
  });
});

describe('buy 4 pay 2 (agreed business examples)', () => {
  it('5 units: two most expensive paid, next two free, cheapest gets 30%', () => {
    const cart = withOffer(units(1000, 800, 600, 400, 300));
    expect(treatments(cart)).toEqual(['offer_paid', 'offer_paid', 'offer_free', 'offer_free', 'default_discount']);
    expect(finalPrices(cart)).toEqual([1000, 800, 0, 0, 210]);
    expect(total(cart)).toBe(2010);
  });

  it('allocates by price, not by the order the items were added', () => {
    const cart = withOffer(units(300, 1000, 400, 800, 600));
    expect(finalPrices(cart)).toEqual([210, 1000, 0, 800, 0]);
    expect(total(cart)).toBe(2010);
  });

  it('8 units: four most expensive paid, four cheapest free', () => {
    const cart = withOffer(units(100, 90, 80, 70, 60, 50, 40, 30));
    expect(finalPrices(cart)).toEqual([100, 90, 80, 70, 0, 0, 0, 0]);
    expect(total(cart)).toBe(340);
  });

  it('4 units: two paid, two free', () => {
    const cart = withOffer(units(500, 400, 300, 200));
    expect(finalPrices(cart)).toEqual([500, 400, 0, 0]);
  });

  it('7 units: one complete group, the three cheapest get 30%', () => {
    const cart = withOffer(units(700, 600, 500, 400, 300, 200, 100));
    expect(finalPrices(cart)).toEqual([700, 600, 0, 0, 210, 140, 70]);
  });

  it('equal prices: earlier pieces are paid, later pieces are free', () => {
    const cart = withOffer(units(500, 500, 500, 500));
    expect(treatments(cart)).toEqual(['offer_paid', 'offer_paid', 'offer_free', 'offer_free']);
  });

  it('cannot be applied to fewer than 4 units', () => {
    expectDomainError(() => createOfferApplication(units(500, 400, 300), BUY4_PAY2), 'OFFER_NOT_APPLICABLE');
  });
});

describe('pieces added after the offer was applied', () => {
  it('get 30% and do not reshuffle the offer, even if more expensive', () => {
    const before = units(1000, 800, 600, 400, 300);
    const application = createOfferApplication(before, BUY4_PAY2);
    const after: CartUnit[] = [
      ...before,
      {
        seq: 6,
        barcode: 'A2000-L',
        itemCode: 'A2000',
        size: 'L',
        listPrice: 400000,
        salePrice: 200000,
        discountable: true,
      },
    ];
    const cart = priceCart(after, SETTINGS, application);
    expect(finalPrices(cart)).toEqual([1000, 800, 0, 0, 210, 1400]);
    expect(total(cart)).toBe(3410);
  });

  it('rejects an offer whose original pieces are no longer all in the cart', () => {
    const before = units(1000, 800, 600, 400, 300);
    const application = createOfferApplication(before, BUY4_PAY2);
    const tampered = before.filter((unit) => unit.seq !== 3);
    expectDomainError(() => priceCart(tampered, SETTINGS, application), 'OFFER_INTEGRITY');
  });
});

describe('offer preview', () => {
  it('shows when the offer saves the customer money', () => {
    const preview = previewOffer(units(1000, 800, 600, 400, 300), SETTINGS, BUY4_PAY2);
    expect(preview).toEqual({ applicable: true, withOffer: 201000, withoutOffer: 217000, customerSaving: 16000 });
  });

  it('warns when the offer costs more than the default 30%', () => {
    const preview = previewOffer(units(1000, 900, 150, 150), SETTINGS, BUY4_PAY2);
    expect(preview).toEqual({ applicable: true, withOffer: 190000, withoutOffer: 154000, customerSaving: -36000 });
  });

  it('is not applicable to small carts', () => {
    expect(previewOffer(units(100, 100, 100), SETTINGS, BUY4_PAY2)).toEqual({ applicable: false, minUnits: 4 });
  });
});

describe('totals', () => {
  it('breaks the total down consistently', () => {
    const { totals } = withOffer(units(1000, 800, 600, 400, 300));
    expect(totals).toEqual({
      unitCount: 5,
      listTotal: 620000,
      saleTotal: 310000,
      defaultDiscountTotal: 9000,
      offerDiscountTotal: 100000,
      total: 201000,
    });
    expect(totals.saleTotal - totals.defaultDiscountTotal - totals.offerDiscountTotal).toBe(totals.total);
  });

  it('prices an empty cart as zero', () => {
    expect(priceCart([], SETTINGS, null).totals.total).toBe(0);
  });
});

describe('validation', () => {
  it('rejects fractional or negative prices', () => {
    const [unit] = units(100);
    expectDomainError(() => priceCart([{ ...unit!, salePrice: 10.5 }], SETTINGS, null), 'INVALID_MONEY');
    expectDomainError(() => priceCart([{ ...unit!, salePrice: -1 }], SETTINGS, null), 'INVALID_MONEY');
  });

  it('rejects duplicate seq numbers', () => {
    const [a, b] = units(100, 200);
    expectDomainError(() => priceCart([a!, { ...b!, seq: 1 }], SETTINGS, null), 'INVALID_UNIT');
  });

  it('rejects invalid offers and discount settings', () => {
    expectDomainError(() => withOffer(units(1, 2, 3, 4), { ...BUY4_PAY2, payQty: 4 }), 'INVALID_OFFER');
    expectDomainError(() => priceCart(units(100), { defaultDiscountPercent: 120 }, null), 'INVALID_PERCENT');
  });

  it('converts spreadsheet pounds to piasters without float drift', () => {
    expect(fromPounds(1.005)).toBe(101);
    expect(fromPounds(799.95)).toBe(79995);
  });
});
