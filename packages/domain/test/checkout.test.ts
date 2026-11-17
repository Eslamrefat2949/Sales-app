import { describe, expect, it } from 'vitest';
import { searchCatalog } from '../src/catalog.ts';
import { normalizeEgyptianMobile } from '../src/customer.ts';
import { DomainError } from '../src/errors.ts';
import { formatInvoiceNumber, parseInvoiceNumber, voidBlocker, voidInvoice, type Invoice } from '../src/invoice.ts';
import { fromPounds } from '../src/money.ts';
import { settlePayments, type PaymentMethod } from '../src/payments.ts';
import { buildSalesReport } from '../src/reports.ts';
import { normalizeDigits } from '../src/text.ts';

const METHODS: PaymentMethod[] = [
  { code: 'CASH', kind: 'cash' },
  { code: 'VISA', kind: 'card' },
  { code: 'INSTAPAY', kind: 'other' },
];

describe('Arabic digits', () => {
  it('converts Arabic-Indic and Persian digits', () => {
    expect(normalizeDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(normalizeDigits('۱۲۳')).toBe('123');
    expect(normalizeDigits('A12٣')).toBe('A123');
  });

  it('lets the seller search with an Arabic keypad', () => {
    expect(searchCatalog([{ itemCode: 'A12345', name: 'Shirt' }], '١٢٣٤٥').map((item) => item.itemCode)).toEqual([
      'A12345',
    ]);
  });
});

describe('normalizeEgyptianMobile', () => {
  it('accepts the usual ways a number is typed', () => {
    expect(normalizeEgyptianMobile('01012345678')).toBe('01012345678');
    expect(normalizeEgyptianMobile('010 1234 5678')).toBe('01012345678');
    expect(normalizeEgyptianMobile('+201112345678')).toBe('01112345678');
    expect(normalizeEgyptianMobile('00201212345678')).toBe('01212345678');
    expect(normalizeEgyptianMobile('٠١٥١٢٣٤٥٦٧٨')).toBe('01512345678');
  });

  it('rejects wrong lengths and prefixes', () => {
    expect(normalizeEgyptianMobile('0101234567')).toBeNull();
    expect(normalizeEgyptianMobile('01312345678')).toBeNull();
    expect(normalizeEgyptianMobile('')).toBeNull();
  });
});

describe('settlePayments', () => {
  const total = fromPounds(2010);

  it('accepts an exact single payment', () => {
    expect(settlePayments(total, [{ methodCode: 'VISA', amount: total }], METHODS)).toEqual({
      ok: true,
      payments: [{ methodCode: 'VISA', amount: total }],
      change: 0,
      tendered: total,
    });
  });

  it('records cash net of change', () => {
    const result = settlePayments(total, [{ methodCode: 'CASH', amount: fromPounds(2100) }], METHODS);
    expect(result).toEqual({
      ok: true,
      payments: [{ methodCode: 'CASH', amount: total }],
      change: fromPounds(90),
      tendered: fromPounds(2100),
    });
  });

  it('splits across methods and gives change from cash only', () => {
    const result = settlePayments(
      total,
      [
        { methodCode: 'VISA', amount: fromPounds(1500) },
        { methodCode: 'CASH', amount: fromPounds(600) },
      ],
      METHODS,
    );
    expect(result).toEqual({
      ok: true,
      payments: [
        { methodCode: 'VISA', amount: fromPounds(1500) },
        { methodCode: 'CASH', amount: fromPounds(510) },
      ],
      change: fromPounds(90),
      tendered: fromPounds(2100),
    });
  });

  it('reports what is still missing', () => {
    expect(settlePayments(total, [{ methodCode: 'CASH', amount: fromPounds(2000) }], METHODS)).toEqual({
      ok: false,
      reason: 'UNDERPAID',
      difference: fromPounds(10),
    });
  });

  it('refuses overpaying by card', () => {
    expect(settlePayments(total, [{ methodCode: 'VISA', amount: fromPounds(2100) }], METHODS)).toEqual({
      ok: false,
      reason: 'OVERPAID_WITHOUT_CASH',
      difference: fromPounds(90),
    });
  });

  it('refuses methods the branch does not offer', () => {
    expect(settlePayments(total, [{ methodCode: 'VALU', amount: total }], METHODS)).toMatchObject({
      ok: false,
      reason: 'UNKNOWN_METHOD',
    });
  });
});

describe('invoice numbers', () => {
  it('formats and parses the branch and sequence', () => {
    expect(formatInvoiceNumber({ branchCode: 'OCT', seq: 42 })).toBe('OCT-APP-000042');
    expect(parseInvoiceNumber('oct-app-000042')).toEqual({ branchCode: 'OCT', seq: 42 });
    expect(parseInvoiceNumber('Mall of Arabia - 12001556')).toBeNull();
  });

  it('rejects invalid parts', () => {
    expect(() => formatInvoiceNumber({ branchCode: 'a b', seq: 1 })).toThrow(DomainError);
    expect(() => formatInvoiceNumber({ branchCode: 'OCT', seq: 0 })).toThrow(DomainError);
  });
});

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    number: 'OCT-APP-000001',
    branchCode: 'OCT',
    deviceNo: 1,
    createdAt: '2026-11-17T12:00:00.000Z',
    businessDate: '2026-11-17',
    salesPersonId: 'emp-1',
    customer: { mobile: '01012345678', name: 'Mona' },
    lines: [],
    offer: null,
    totals: {
      unitCount: 3,
      listTotal: 400000,
      saleTotal: 200000,
      defaultDiscountTotal: 60000,
      offerDiscountTotal: 0,
      total: 140000,
    },
    payments: [{ methodCode: 'CASH', amount: 140000 }],
    change: 0,
    status: 'completed',
    exportedAt: null,
    void: null,
    ...overrides,
  };
}

describe('voids', () => {
  it('voids a same-day invoice that is not exported yet', () => {
    const voided = voidInvoice(invoice(), '2026-11-17', ' customer returned ', '2026-11-17T15:00:00.000Z');
    expect(voided.status).toBe('voided');
    expect(voided.void).toEqual({ reason: 'customer returned', at: '2026-11-17T15:00:00.000Z' });
  });

  it('explains why a void is not allowed', () => {
    expect(voidBlocker(invoice({ exportedAt: '2026-11-17T23:00:00.000Z' }), '2026-11-17', 'x')).toBe(
      'ALREADY_EXPORTED',
    );
    expect(voidBlocker(invoice(), '2026-11-18', 'x')).toBe('DIFFERENT_DAY');
    expect(voidBlocker(invoice(), '2026-11-17', '  ')).toBe('REASON_REQUIRED');
    expect(voidBlocker(invoice({ status: 'voided' }), '2026-11-17', 'x')).toBe('ALREADY_VOIDED');
    expect(() => voidInvoice(invoice(), '2026-11-18', 'x', 'now')).toThrow(DomainError);
  });
});

describe('buildSalesReport', () => {
  const invoices = [
    invoice({ number: 'OCT-APP-000001' }),
    invoice({
      number: 'OCT-APP-000002',
      salesPersonId: 'emp-2',
      totals: {
        unitCount: 5,
        listTotal: 0,
        saleTotal: 0,
        defaultDiscountTotal: 0,
        offerDiscountTotal: 0,
        total: 201000,
      },
      payments: [
        { methodCode: 'VISA', amount: 150000 },
        { methodCode: 'CASH', amount: 51000 },
      ],
    }),
    invoice({ number: 'OCT-APP-000003', deviceNo: 2, status: 'voided' }),
  ];

  it('totals completed invoices and lists voids separately', () => {
    const { overall } = buildSalesReport(invoices);
    expect(overall).toEqual({
      invoiceCount: 2,
      unitCount: 8,
      total: 341000,
      averageInvoice: 170500,
      unitsPerInvoice: 4,
      byPaymentMethod: { CASH: 191000, VISA: 150000 },
      voided: { count: 1, total: 140000 },
    });
  });

  it('breaks the summary down per sales person and per phone', () => {
    const report = buildSalesReport(invoices);
    expect(report.bySalesPerson['emp-1']).toMatchObject({
      invoiceCount: 1,
      total: 140000,
      voided: { count: 1, total: 140000 },
    });
    expect(report.bySalesPerson['emp-2']).toMatchObject({
      invoiceCount: 1,
      total: 201000,
      byPaymentMethod: { VISA: 150000, CASH: 51000 },
    });
    expect(Object.keys(report.byDevice)).toEqual(['M1', 'M2']);
  });

  it('returns zeros for an empty day', () => {
    expect(buildSalesReport([]).overall).toMatchObject({
      invoiceCount: 0,
      total: 0,
      averageInvoice: 0,
      unitsPerInvoice: 0,
    });
  });
});
