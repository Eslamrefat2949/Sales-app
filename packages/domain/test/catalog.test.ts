import { describe, expect, it } from 'vitest';
import { searchCatalog, sortSizes } from '../src/catalog.ts';

const ITEMS = [
  { itemCode: 'A12345', name: 'Linen Shirt' },
  { itemCode: 'B12399', name: 'Denim Jacket' },
  { itemCode: 'A99123', name: 'Cotton Shirt' },
  { itemCode: 'C45123', name: 'Wide Leg Pants' },
];

const codes = (query: string): string[] => searchCatalog(ITEMS, query).map((item) => item.itemCode);

describe('searchCatalog', () => {
  it('finds an item from its digits only, so the numeric keypad is enough', () => {
    expect(codes('12345')).toEqual(['A12345']);
  });

  it('also accepts the full code in any case', () => {
    expect(codes('a12345')).toEqual(['A12345']);
  });

  it('ranks digit prefixes before codes that only contain the digits', () => {
    expect(codes('123')).toEqual(['A12345', 'B12399', 'A99123', 'C45123']);
  });

  it('falls back to the item name', () => {
    expect(codes('shirt')).toEqual(['A12345', 'A99123']);
  });

  it('returns nothing for an empty query and respects the limit', () => {
    expect(codes('  ')).toEqual([]);
    expect(searchCatalog(ITEMS, '1', 2)).toHaveLength(2);
  });
});

describe('sortSizes', () => {
  it('orders letter sizes the way sellers read them', () => {
    expect(sortSizes(['XL', 'S', 'XXL', 'M', 'L', 'XS'])).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL']);
  });

  it('orders numeric and kids sizes by their number', () => {
    expect(sortSizes(['40', '38', '42', '36'])).toEqual(['36', '38', '40', '42']);
    expect(sortSizes(['10-11Y', '2-3Y', '4-5Y'])).toEqual(['2-3Y', '4-5Y', '10-11Y']);
  });

  it('puts unknown sizes last', () => {
    expect(sortSizes(['ONE SIZE', 'M', '38'])).toEqual(['M', '38', 'ONE SIZE']);
  });
});
