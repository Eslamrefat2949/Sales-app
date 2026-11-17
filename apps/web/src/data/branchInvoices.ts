import type { Invoice, PricedUnit } from '@ravin-sales/domain';
import writeXlsxFile, { type Row } from 'write-excel-file/browser';
import { safeFileName } from '../lib/files.ts';
import { supabase, unwrap } from '../lib/supabase.ts';
import type { AppConfig } from './appData.ts';
import type { InvoicePayload, PendingInvoice } from './branchSync.ts';

/** A branch invoice as shown in the report: from the server, or still waiting on this phone. */
export interface ReportInvoice extends Invoice {
  readonly deviceId: string;
  /** Odoo name of the sales person, read with the invoice so a later staff change does not lose it. */
  readonly salesPersonName: string | null;
  readonly synced: boolean;
  readonly syncError: string | null;
}

interface InvoiceRow {
  number: string;
  device_id: string;
  business_date: string;
  sold_at: string;
  sales_person_id: string;
  customer_mobile: string | null;
  customer_name: string | null;
  offer: Invoice['offer'];
  unit_count: number;
  list_total: number;
  sale_total: number;
  default_discount_total: number;
  offer_discount_total: number;
  total: number;
  change_given: number;
  status: Invoice['status'];
  void_reason: string | null;
  voided_at: string | null;
  export_batch_id: string | null;
  invoice_lines: {
    seq: number;
    barcode: string;
    item_code: string;
    size: string;
    list_price: number;
    sale_price: number;
    discountable: boolean;
    treatment: PricedUnit['treatment'];
    discount_percent: number;
    discount_amount: number;
    final_price: number;
  }[];
  invoice_payments: { method_id: string; amount: number; journal: string }[];
  sales_person?: { odoo_name: string } | null;
}

const INVOICE_COLUMNS =
  'number, device_id, business_date, sold_at, sales_person_id, customer_mobile, customer_name, offer, unit_count, ' +
  'list_total, sale_total, default_discount_total, offer_discount_total, total, change_given, status, void_reason, ' +
  'voided_at, export_batch_id, invoice_lines(*), invoice_payments(method_id, amount, journal), ' +
  'sales_person:employees(odoo_name)';

function lineFrom(row: InvoiceRow['invoice_lines'][number]): PricedUnit {
  return {
    seq: row.seq,
    barcode: row.barcode,
    itemCode: row.item_code,
    size: row.size,
    listPrice: Number(row.list_price),
    salePrice: Number(row.sale_price),
    discountable: row.discountable,
    treatment: row.treatment,
    discountPercent: Number(row.discount_percent),
    discountAmount: Number(row.discount_amount),
    finalPrice: Number(row.final_price),
  };
}

function fromRow(row: InvoiceRow, branchCode: string): ReportInvoice {
  return {
    number: row.number,
    branchCode,
    deviceNo: 0,
    deviceId: row.device_id,
    salesPersonName: row.sales_person?.odoo_name ?? null,
    createdAt: row.sold_at,
    businessDate: row.business_date,
    salesPersonId: row.sales_person_id,
    customer: { mobile: row.customer_mobile ?? '', name: row.customer_name ?? '' },
    lines: [...row.invoice_lines].sort((a, b) => a.seq - b.seq).map(lineFrom),
    offer: row.offer,
    totals: {
      unitCount: row.unit_count,
      listTotal: Number(row.list_total),
      saleTotal: Number(row.sale_total),
      defaultDiscountTotal: Number(row.default_discount_total),
      offerDiscountTotal: Number(row.offer_discount_total),
      total: Number(row.total),
    },
    payments: row.invoice_payments.map((payment) => ({
      methodCode: payment.method_id,
      amount: Number(payment.amount),
    })),
    change: Number(row.change_given),
    status: row.status,
    exportedAt: row.export_batch_id,
    void: row.voided_at ? { reason: row.void_reason ?? '', at: row.voided_at } : null,
    synced: true,
    syncError: null,
  };
}

export function fromPending({ payload, lastError }: PendingInvoice, branchCode: string): ReportInvoice {
  return fromRow(
    {
      ...payload,
      customer_mobile: payload.customer_mobile || null,
      customer_name: payload.customer_name || null,
      status: 'completed',
      void_reason: null,
      voided_at: null,
      export_batch_id: null,
      invoice_lines: payload.lines.map((line) => ({ ...line })),
      invoice_payments: payload.payments.map((payment) => ({ ...payment, journal: '' })),
    } as InvoiceRow,
    branchCode,
  ) as ReportInvoice & { synced: boolean };
}

/**
 * Invoices of the open period: not closed yet, plus the ones voided since the last close, so the
 * report starts again from zero after every close. Row level security limits a branch to its own invoices.
 */
export async function fetchOpenInvoices(config: AppConfig, lastCloseAt: string | null): Promise<ReportInvoice[]> {
  let query = supabase.from('invoices').select(INVOICE_COLUMNS).is('export_batch_id', null);
  if (lastCloseAt) query = query.or(`status.eq.completed,voided_at.gt."${lastCloseAt}"`);
  const rows = unwrap(await query.order('sold_at', { ascending: false })) as unknown as InvoiceRow[];
  return rows.map((row) => fromRow(row, config.branch?.code ?? ''));
}

export async function voidInvoiceOnServer(number: string, reason: string): Promise<void> {
  unwrap(await supabase.rpc('void_invoice', { p_number: number, p_reason: reason }));
}

export function mergeWithPending(
  server: readonly ReportInvoice[],
  pending: readonly PendingInvoice[],
  branchCode: string,
) {
  const known = new Set(server.map((invoice) => invoice.number));
  const waiting = pending
    .filter((item) => !known.has(item.payload.number))
    .map((item) => ({ ...fromPending(item, branchCode), synced: false, syncError: item.lastError }));
  return [...waiting, ...server];
}

// ---------------------------------------------------------------------------------------------
// Odoo export (POS Import format)
// ---------------------------------------------------------------------------------------------

export interface ExportPreview {
  readonly invoices: number;
  readonly total: number;
  readonly pendingOnPhones: number;
}

export async function previewExport(): Promise<ExportPreview> {
  const [invoices, devices] = await Promise.all([
    supabase.from('invoices').select('total').is('export_batch_id', null).eq('status', 'completed'),
    supabase.from('devices').select('pending_count').eq('is_blocked', false),
  ]);
  const rows = unwrap(invoices) as { total: number }[];
  const phones = unwrap(devices) as { pending_count: number }[];
  return {
    invoices: rows.length,
    total: rows.reduce((sum, row) => sum + Number(row.total), 0),
    pendingOnPhones: phones.reduce((sum, row) => sum + row.pending_count, 0),
  };
}

/** One close of day: the invoices it locked and the sale dates they cover. */
export interface ExportBatch {
  readonly id: string;
  readonly createdAt: string;
  readonly invoiceCount: number;
  readonly total: number;
  readonly downloadCount: number;
  /** First and last sale date (YYYY-MM-DD) in the batch; the same day in the normal case. */
  readonly firstDate: string;
  readonly lastDate: string;
  /** Invoices voided since the previous close, for the closing photo. */
  readonly voidedCount: number;
  readonly voidedTotal: number;
}

const BATCH_COLUMNS =
  'id, created_at, invoice_count, total, download_count, first_business_date, last_business_date, voided_count, voided_total';

interface BatchRow {
  id: string;
  created_at: string;
  invoice_count: number;
  total: number;
  download_count: number;
  first_business_date: string | null;
  last_business_date: string | null;
  voided_count: number;
  voided_total: number;
}

const cairoDate = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));

function batchFrom(row: BatchRow): ExportBatch {
  const fallback = cairoDate(row.created_at);
  return {
    id: row.id,
    createdAt: row.created_at,
    invoiceCount: row.invoice_count,
    total: Number(row.total),
    downloadCount: row.download_count,
    firstDate: row.first_business_date ?? fallback,
    lastDate: row.last_business_date ?? row.first_business_date ?? fallback,
    voidedCount: row.voided_count,
    voidedTotal: Number(row.voided_total),
  };
}

export async function listExportBatches(): Promise<ExportBatch[]> {
  const rows = unwrap(
    await supabase.from('export_batches').select(BATCH_COLUMNS).order('created_at', { ascending: false }).limit(15),
  ) as unknown as BatchRow[];
  return rows.map(batchFrom);
}

const pounds = (piasters: number) => Math.round(piasters) / 100;

/**
 * Excel dates have no time zone and the writer uses UTC, so build a date whose UTC clock reads the
 * Cairo wall-clock time of the sale: Odoo then shows the time the customer paid.
 */
export function cairoWallClock(iso: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, Number(part.value)]),
  );
  const part = (name: string) => parts[name] ?? 0;
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second')));
}

/**
 * One row per piece. Order fields (date, customer, sales person) on the first row of each order;
 * each payment on its own row from the first row down. price_unit is the price on the system and
 * discount the line discount in percent (30, 0 or 100), so Odoo computes the same total.
 */
export function buildOdooRows(
  invoices: readonly ReportInvoice[],
  journalByMethod: ReadonlyMap<string, string>,
  employeeName: ReadonlyMap<string, string>,
): Row[] {
  const header: Row = [
    'order_ref',
    'product_barcode',
    'qty',
    'date',
    'partner_name',
    'partner_phone',
    'price_unit',
    'payment_amount',
    'payment_method',
    'salesperson',
    'discount',
  ].map((value) => ({ value, fontWeight: 'bold' as const }));
  const rows: Row[] = [header];
  for (const invoice of [...invoices].sort((a, b) => a.number.localeCompare(b.number))) {
    const count = Math.max(invoice.lines.length, invoice.payments.length);
    for (let index = 0; index < count; index += 1) {
      const line = invoice.lines[index];
      const payment = invoice.payments[index];
      const first = index === 0;
      rows.push([
        invoice.number,
        line?.barcode ?? null,
        line ? 1 : null,
        first ? { value: cairoWallClock(invoice.createdAt), type: Date, format: 'yyyy-mm-dd hh:mm:ss' } : null,
        first ? invoice.customer.name || null : null,
        first ? invoice.customer.mobile || null : null,
        line ? pounds(line.salePrice) : null,
        payment ? pounds(payment.amount) : null,
        payment ? (journalByMethod.get(payment.methodCode) ?? payment.methodCode) : null,
        first ? (invoice.salesPersonName ?? employeeName.get(invoice.salesPersonId) ?? null) : null,
        line ? line.discountPercent : null,
      ]);
    }
  }
  return rows;
}

/** A close of day with its invoices, ready to become the Odoo sheet and the closing photo. */
export interface ClosedDay {
  readonly batch: ExportBatch;
  readonly invoices: readonly ReportInvoice[];
}

async function fetchBatchInvoices(config: AppConfig, batchId: string): Promise<ReportInvoice[]> {
  const rows = unwrap(
    await supabase.from('invoices').select(INVOICE_COLUMNS).eq('export_batch_id', batchId),
  ) as unknown as InvoiceRow[];
  return rows.map((row) => fromRow(row, config.branch?.code ?? ''));
}

/**
 * Closes the day: locks every invoice not exported yet into a new batch (the server numbers nothing
 * here, invoice numbers keep counting from where they are). Null when there is nothing to close.
 */
export async function closeDay(config: AppConfig): Promise<ClosedDay | null> {
  const result = unwrap(await supabase.rpc('create_export_batch')) as { batch_id: string | null };
  if (!result.batch_id) return null;
  return openBatch(config, result.batch_id);
}

/** Reads an earlier close again (for its photo or its sheet). */
export async function openBatch(config: AppConfig, batchId: string): Promise<ClosedDay> {
  const [row, invoices] = await Promise.all([
    supabase.from('export_batches').select(BATCH_COLUMNS).eq('id', batchId).single(),
    fetchBatchInvoices(config, batchId),
  ]);
  return { batch: batchFrom(unwrap(row) as unknown as BatchRow), invoices };
}

/** Counts a repeated sheet download on the server, so a double import into Odoo can be traced. */
export async function recordSheetDownload(batchId: string): Promise<void> {
  unwrap(await supabase.rpc('record_export_download', { p_batch_id: batchId }));
}

/** "2026-11-18", or "2026-11-17 to 2026-11-18" when late invoices from an earlier day were in the close. */
export function batchDates(batch: Pick<ExportBatch, 'firstDate' | 'lastDate'>): string {
  return batch.firstDate === batch.lastDate ? batch.firstDate : `${batch.firstDate} to ${batch.lastDate}`;
}

/** e.g. "OCT - 6th of October Outlet Mall - 2026-11-18": the branch and the day it sold. */
export function closingFileStem(config: AppConfig, batch: Pick<ExportBatch, 'firstDate' | 'lastDate'>): string {
  const branch = config.branch ? `${config.branch.code} - ${config.branch.posName}` : 'RAVIN';
  return safeFileName(`${branch} - ${batchDates(batch)}`);
}

/** The Odoo POS Import sheet of a close, named after the branch and the sale date. */
export async function odooSheet(config: AppConfig, closed: ClosedDay): Promise<{ blob: Blob; fileName: string }> {
  const journals = new Map(config.paymentMethods.map((method) => [method.code, method.journal]));
  const employees = new Map(config.employees.map((employee) => [employee.id, employee.name]));
  const blob = await writeXlsxFile(buildOdooRows(closed.invoices, journals, employees)).toBlob();
  return { blob, fileName: `${closingFileStem(config, closed.batch)}.xlsx` };
}

export type { InvoicePayload };
