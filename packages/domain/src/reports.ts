import type { Invoice } from './invoice.ts';
import type { Money } from './money.ts';

export interface SalesSummary {
  readonly invoiceCount: number;
  readonly unitCount: number;
  readonly total: Money;
  /** Average invoice value, rounded to the piaster. 0 when there are no invoices. */
  readonly averageInvoice: Money;
  /** Pieces per invoice, two decimals. */
  readonly unitsPerInvoice: number;
  /** Recorded amount per payment method code (change already deducted from cash). */
  readonly byPaymentMethod: Readonly<Record<string, Money>>;
  readonly voided: { readonly count: number; readonly total: Money };
}

export interface SalesReport {
  readonly overall: SalesSummary;
  readonly bySalesPerson: Readonly<Record<string, SalesSummary>>;
  readonly byDevice: Readonly<Record<string, SalesSummary>>;
}

function summarize(invoices: readonly Invoice[]): SalesSummary {
  const completed = invoices.filter((invoice) => invoice.status === 'completed');
  const voided = invoices.filter((invoice) => invoice.status === 'voided');
  const total = completed.reduce((sum, invoice) => sum + invoice.totals.total, 0);
  const unitCount = completed.reduce((sum, invoice) => sum + invoice.totals.unitCount, 0);
  const byPaymentMethod: Record<string, Money> = {};
  for (const invoice of completed) {
    for (const payment of invoice.payments) {
      byPaymentMethod[payment.methodCode] = (byPaymentMethod[payment.methodCode] ?? 0) + payment.amount;
    }
  }
  const count = completed.length;
  return {
    invoiceCount: count,
    unitCount,
    total,
    averageInvoice: count === 0 ? 0 : Math.round(total / count),
    unitsPerInvoice: count === 0 ? 0 : Math.round((unitCount / count) * 100) / 100,
    byPaymentMethod,
    voided: { count: voided.length, total: voided.reduce((sum, invoice) => sum + invoice.totals.total, 0) },
  };
}

function groupBy(invoices: readonly Invoice[], key: (invoice: Invoice) => string): Record<string, SalesSummary> {
  const groups = new Map<string, Invoice[]>();
  for (const invoice of invoices) {
    const groupKey = key(invoice);
    const group = groups.get(groupKey);
    if (group) group.push(invoice);
    else groups.set(groupKey, [invoice]);
  }
  return Object.fromEntries([...groups].map(([groupKey, group]) => [groupKey, summarize(group)]));
}

/** Sales summary for the given invoices: overall, per sales person and per phone. */
export function buildSalesReport(invoices: readonly Invoice[]): SalesReport {
  return {
    overall: summarize(invoices),
    bySalesPerson: groupBy(invoices, (invoice) => invoice.salesPersonId),
    byDevice: groupBy(invoices, (invoice) => `M${invoice.deviceNo}`),
  };
}
