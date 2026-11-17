import { DomainError } from './errors.ts';
import type { PaymentLine } from './payments.ts';
import type { CartTotals, OfferApplication, PricedUnit } from './pricing.ts';

export interface InvoiceNumberParts {
  /** Branch short code from the branch mapping, e.g. "OCT". */
  readonly branchCode: string;
  /** Number within the branch. Phones draw these from blocks reserved on the server, so they work offline. */
  readonly seq: number;
}

const BRANCH_CODE = /^[A-Z0-9]{2,8}$/;
const INVOICE_NUMBER = /^([A-Z0-9]{2,8})-APP-(\d{6,})$/;

/**
 * Builds the invoice number, e.g. OCT-APP-000042: the branch code, "APP" so it never clashes with the
 * cashier's Odoo numbers, then the branch sequence. It is also the Odoo order_ref.
 */
export function formatInvoiceNumber({ branchCode, seq }: InvoiceNumberParts): string {
  if (!BRANCH_CODE.test(branchCode)) {
    throw new DomainError('INVALID_INVOICE', `branch code must be 2-8 capital letters or digits, got "${branchCode}"`);
  }
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new DomainError('INVALID_INVOICE', `invoice sequence must be a positive integer, got ${seq}`);
  }
  return `${branchCode}-APP-${String(seq).padStart(6, '0')}`;
}

export function parseInvoiceNumber(value: string): InvoiceNumberParts | null {
  const match = INVOICE_NUMBER.exec(value.trim().toUpperCase());
  if (!match) return null;
  return { branchCode: match[1]!, seq: Number(match[2]) };
}

export type InvoiceStatus = 'completed' | 'voided';

export interface Invoice {
  readonly number: string;
  readonly branchCode: string;
  readonly deviceNo: number;
  /** ISO timestamp. */
  readonly createdAt: string;
  /** Branch business date (YYYY-MM-DD) the sale belongs to. */
  readonly businessDate: string;
  readonly salesPersonId: string;
  /** Optional: empty strings when the customer gave no details. */
  readonly customer: { readonly mobile: string; readonly name: string };
  readonly lines: readonly PricedUnit[];
  readonly offer: OfferApplication | null;
  readonly totals: CartTotals;
  readonly payments: readonly PaymentLine[];
  readonly change: number;
  readonly status: InvoiceStatus;
  readonly exportedAt: string | null;
  readonly void: { readonly reason: string; readonly at: string } | null;
}

export type VoidBlocker = 'ALREADY_VOIDED' | 'ALREADY_EXPORTED' | 'DIFFERENT_DAY' | 'REASON_REQUIRED';

/** Why an invoice cannot be voided right now, or null if it can. */
export function voidBlocker(invoice: Invoice, businessDate: string, reason: string): VoidBlocker | null {
  if (invoice.status === 'voided') return 'ALREADY_VOIDED';
  if (invoice.exportedAt !== null) return 'ALREADY_EXPORTED';
  if (invoice.businessDate !== businessDate) return 'DIFFERENT_DAY';
  if (reason.trim() === '') return 'REASON_REQUIRED';
  return null;
}

/**
 * Voids a whole invoice (a return). The invoice is kept with its details so it still appears in the
 * summary; it is only excluded from the export and from sales totals.
 */
export function voidInvoice(invoice: Invoice, businessDate: string, reason: string, at: string): Invoice {
  const blocker = voidBlocker(invoice, businessDate, reason);
  if (blocker) throw new DomainError('VOID_NOT_ALLOWED', `cannot void ${invoice.number}: ${blocker}`);
  return { ...invoice, status: 'voided', void: { reason: reason.trim(), at } };
}
