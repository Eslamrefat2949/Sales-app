import { describe, expect, it } from 'vitest';
import { findItemListColumns, itemCodeOf, prepareCatalogImport, readItemListRows } from '../src/catalog-import.ts';

const row = (reference: unknown, size: unknown, listPrice: unknown, salePrice: unknown) => ({
  reference,
  size,
  listPrice,
  salePrice,
});

describe('prepareCatalogImport (Odoo Product Variant export)', () => {
  it('keeps barcodes exactly and converts prices to piasters', () => {
    const { products } = prepareCatalogImport([
      row('R219822-L', 'L', 3299.99, 2299.99),
      row('O178475-One Size', 'One Size', 195, 195),
      row('98134-40', 40, 899, 599),
    ]);
    expect(products).toEqual([
      { barcode: 'R219822-L', itemCode: 'R219822', size: 'L', name: null, listPrice: 329999, salePrice: 229999 },
      {
        barcode: 'O178475-One Size',
        itemCode: 'O178475',
        size: 'One Size',
        name: null,
        listPrice: 19500,
        salePrice: 19500,
      },
      { barcode: '98134-40', itemCode: '98134', size: '40', name: null, listPrice: 89900, salePrice: 59900 },
    ]);
  });

  it('leaves out items without a price', () => {
    const result = prepareCatalogImport([row('97055-28', 28, 0, 0), row('R1-M', 'M', 100, 50)]);
    expect(result.skipped.noPrice).toEqual(['97055-28']);
    expect(result.products).toHaveLength(1);
  });

  it('blocks every copy of a barcode that appears more than once, including case and spaces', () => {
    const result = prepareCatalogImport([
      row('97377-XS', 'L', 449.99, 389.99),
      row('97377-XS', 'M', 449.99, 389.99),
      row('Basic-X', 'S', 399.99, 239.99),
      row('BASIC-X', 'S', 399.99, 239.99),
      row('R1-M', 'M', 100, 50),
    ]);
    expect(result.products.map((product) => product.barcode)).toEqual(['R1-M']);
    expect([...result.skipped.duplicateBarcode].sort()).toEqual(['97377-XS', 'BASIC-X', 'Basic-X'].sort());
  });

  it('reports rows it cannot read', () => {
    const result = prepareCatalogImport([row('', 'M', 1, 1), row('R1-M', 'M', 'abc', 10)]);
    expect(result.skipped.invalid).toEqual(['(empty)', 'R1-M']);
  });

  it('never lets the price before be lower than the price after', () => {
    const { products } = prepareCatalogImport([row('R1-M', 'M', 100, 150)]);
    expect(products[0]).toMatchObject({ listPrice: 15000, salePrice: 15000 });
  });

  it('takes the item code from the reference', () => {
    expect(itemCodeOf('R219822-L')).toBe('R219822');
    expect(itemCodeOf('K50101-2-3Y')).toBe('K50101');
    expect(itemCodeOf('W22W459')).toBe('W22W459');
  });
});

describe('reading the Odoo export layout', () => {
  const header = ['Internal Reference', 'SIZE', 'Original Sales Price (MSRP)', 'Sales\u00a0Price', 'Automated Barcode'];

  it('finds the columns, including a header with a non-breaking space', () => {
    expect(findItemListColumns(header)).toEqual({ reference: 0, size: 1, listPrice: 2, salePrice: 3, name: -1 });
  });

  it('names the missing columns', () => {
    expect(findItemListColumns(['Internal Reference', 'SIZE'])).toEqual({
      missing: ['original sales price (msrp)', 'sales price'],
    });
  });

  it('reads the rows after the header', () => {
    const columns = findItemListColumns(header);
    if ('missing' in columns) throw new Error('columns not found');
    const rows = readItemListRows([header, ['R219822-L', 'L', 3299.99, 2299.99, 'R219822']], columns);
    expect(prepareCatalogImport(rows).products[0]).toMatchObject({ barcode: 'R219822-L', salePrice: 229999 });
  });
});
