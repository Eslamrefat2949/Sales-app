import { formatInvoiceNumber, parseInvoiceNumber, voidInvoice, type Invoice } from '@ravin-sales/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BRANCH, DEVICE_NO } from '../config/demo.ts';
import { readJson, writeJson } from '../lib/storage.ts';

export type NewInvoice = Omit<Invoice, 'number' | 'branchCode' | 'deviceNo' | 'status' | 'exportedAt' | 'void'>;

export interface InvoiceStore {
  readonly invoices: readonly Invoice[];
  /** Mobile → last name used, so a returning customer's name fills in. */
  readonly knownCustomers: ReadonlyMap<string, string>;
  readonly createInvoice: (input: NewInvoice) => Invoice;
  readonly voidInvoice: (number: string, businessDate: string, reason: string) => void;
}

/**
 * Next sequence for this phone. Uses the stored counter and the highest number already issued, so a
 * lost counter can never produce a duplicate number.
 */
function nextSequence(invoices: readonly Invoice[]): number {
  const counter = readJson<number>('invoice-counter', 0);
  const highestIssued = invoices.reduce((max, invoice) => {
    const parts = parseInvoiceNumber(invoice.number);
    return parts && parts.deviceNo === DEVICE_NO ? Math.max(max, parts.seq) : max;
  }, 0);
  return Math.max(counter, highestIssued) + 1;
}

export function useInvoiceStore(): InvoiceStore {
  const [invoices, setInvoices] = useState<readonly Invoice[]>(() => readJson<Invoice[]>('invoices', []));
  useEffect(() => writeJson('invoices', invoices), [invoices]);

  const createInvoice = useCallback(
    (input: NewInvoice): Invoice => {
      const seq = nextSequence(invoices);
      writeJson('invoice-counter', seq);
      const invoice: Invoice = {
        ...input,
        number: formatInvoiceNumber({ branchCode: BRANCH.code, deviceNo: DEVICE_NO, seq }),
        branchCode: BRANCH.code,
        deviceNo: DEVICE_NO,
        status: 'completed',
        exportedAt: null,
        void: null,
      };
      setInvoices((current) => [invoice, ...current]);
      return invoice;
    },
    [invoices],
  );

  const voidOne = useCallback(
    (number: string, businessDate: string, reason: string) => {
      const target = invoices.find((invoice) => invoice.number === number);
      if (!target) return;
      // Throws a DomainError to the caller if the void is not allowed.
      const voided = voidInvoice(target, businessDate, reason, new Date().toISOString());
      setInvoices((current) => current.map((invoice) => (invoice.number === number ? voided : invoice)));
    },
    [invoices],
  );

  const knownCustomers = useMemo(() => {
    const map = new Map<string, string>();
    for (const invoice of [...invoices].reverse()) map.set(invoice.customer.mobile, invoice.customer.name);
    return map;
  }, [invoices]);

  return { invoices, knownCustomers, createInvoice, voidInvoice: voidOne };
}
