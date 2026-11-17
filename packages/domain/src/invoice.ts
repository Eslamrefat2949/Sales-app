import { DomainError } from './errors.ts';
import type { PaymentLine } from './payments.ts';
import type { CartTotals, OfferApplication, PricedUnit } from './pricing.ts';

export interface InvoiceNumberParts {
  /** Branch short code from the branch mapping, e.g. "ABC". */
  readonly branchCode: string;
  /** Number given to the phone the first time it is set up in the branch. Never reused. */
  readonly deviceNo: number;
  /** Invoice counter on that phone, starting at 1. */
  readonly seq: number;
}

const BRANCH_CODE = /^[A-Z0-9]{2,8}$/;
const INVOICE_NUMBER = /^([A-Z0-9]{2,8})-M(\d+)-(\d{5,})$/;

/**
 * Builds the invoice number, e.g. ABC-M2-00042. Unique without a server round trip because each phone
 * owns its device number, so phones can sell offline. The "M" keeps it apart from Odoo's own POS numbers.
 */
export function formatInvoiceNumber({ branchCode, deviceNo, seq }: InvoiceNumberParts): string {
  if (!BRANCH_CODE.test(branchCode)) {
    throw new DomainError('INVALID_INVOICE', `branch code must be 2-8 capital letters or digits, got "${branchCode}"`);
  }
  if (!Number.isSafeInteger(deviceNo) || deviceNo < 1 || !Number.isSafeInteger(seq) || seq < 1) {
    throw new DomainError('INVALID_INVOICE', `device number and sequence must be positive integers`);
  }
  return `${branchCode}-M${deviceNo}-${String(seq).padStart(5, '0')}`;
}

export function parseInvoiceNumber(value: string): InvoiceNumberParts | null {
  const match = INVOICE_NUMBER.exec(value.trim().toUpperCase());
  if (!match) return null;
  return { branchCode: match[1]!, deviceNo: Number(match[2]), seq: Number(match[3]) };
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
