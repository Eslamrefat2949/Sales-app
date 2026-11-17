import type { CartTotals, Invoice, OfferApplication, PaymentLine, PricedUnit } from '@ravin-sales/domain';
import { formatInvoiceNumber } from '@ravin-sales/domain';
import { useCallback, useEffect, useRef, useState } from 'react';
import { idbGet, idbSet } from '../lib/idb.ts';
import { readJson, writeJson } from '../lib/storage.ts';
import { errorCode, supabase, unwrap } from '../lib/supabase.ts';
import type { AppConfig } from './appData.ts';

/** What the phone sends to sync_invoice. Money in piasters. */
export interface InvoicePayload {
  readonly number: string;
  readonly seq: number;
  readonly device_id: string;
  readonly business_date: string;
  readonly sold_at: string;
  readonly sales_person_id: string;
  readonly customer_mobile: string;
  readonly customer_name: string;
  readonly default_discount_percent: number;
  readonly offer: OfferApplication | null;
  readonly unit_count: number;
  readonly list_total: number;
  readonly sale_total: number;
  readonly default_discount_total: number;
  readonly offer_discount_total: number;
  readonly total: number;
  readonly change_given: number;
  readonly lines: readonly {
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
  readonly payments: readonly { method_id: string; amount: number }[];
}

export interface PendingInvoice {
  readonly payload: InvoicePayload;
  readonly lastError: string | null;
}

interface Device {
  readonly id: string;
  readonly number: number;
}

interface NumberBlocks {
  readonly blocks: readonly { readonly first: number; readonly last: number }[];
  /** Last number handed out on this phone. */
  readonly cursor: number;
}

const REFILL_BELOW = 30;
const BLOCK_SIZE = 100;
const SYNC_EVERY_MS = 20_000;

function remainingNumbers({ blocks, cursor }: NumberBlocks): number {
  return blocks.reduce((sum, block) => sum + Math.max(0, block.last - Math.max(block.first - 1, cursor)), 0);
}

function nextNumber({ blocks, cursor }: NumberBlocks): number | null {
  for (const block of [...blocks].sort((a, b) => a.first - b.first)) {
    const candidate = Math.max(block.first, cursor + 1);
    if (candidate <= block.last) return candidate;
  }
  return null;
}

export function toPayload(
  invoice: Invoice,
  extra: { seq: number; deviceId: string; defaultDiscountPercent: number },
): InvoicePayload {
  const totals: CartTotals = invoice.totals;
  return {
    number: invoice.number,
    seq: extra.seq,
    device_id: extra.deviceId,
    business_date: invoice.businessDate,
    sold_at: invoice.createdAt,
    sales_person_id: invoice.salesPersonId,
    customer_mobile: invoice.customer.mobile,
    customer_name: invoice.customer.name,
    default_discount_percent: extra.defaultDiscountPercent,
    offer: invoice.offer,
    unit_count: totals.unitCount,
    list_total: totals.listTotal,
    sale_total: totals.saleTotal,
    default_discount_total: totals.defaultDiscountTotal,
    offer_discount_total: totals.offerDiscountTotal,
    total: totals.total,
    change_given: invoice.change,
    lines: invoice.lines.map((line) => ({
      seq: line.seq,
      barcode: line.barcode,
      item_code: line.itemCode,
      size: line.size,
      list_price: line.listPrice,
      sale_price: line.salePrice,
      discountable: line.discountable,
      treatment: line.treatment,
      discount_percent: line.discountPercent,
      discount_amount: line.discountAmount,
      final_price: line.finalPrice,
    })),
    payments: invoice.payments.map((payment: PaymentLine) => ({
      method_id: payment.methodCode,
      amount: payment.amount,
    })),
  };
}

export interface BranchSync {
  readonly device: Device | null;
  readonly pending: readonly PendingInvoice[];
  readonly online: boolean;
  readonly syncing: boolean;
  readonly lastSyncedAt: string | null;
  /** Reserves the next invoice number on this phone; null if it has none left and is offline. */
  readonly takeNumber: () => { number: string; seq: number } | null;
  /** Saves an invoice on the phone and sends it as soon as possible. */
  readonly enqueue: (payload: InvoicePayload) => Promise<void>;
  readonly syncNow: () => Promise<void>;
}

/**
 * Keeps a branch phone in step with the server: registers the phone once, keeps a block of invoice
 * numbers ready for offline selling, and sends saved invoices whenever there is a connection.
 */
export function useBranchSync(config: AppConfig): BranchSync {
  const branch = config.branch!;
  const deviceKey = `device:${branch.id}`;
  const outboxKey = `outbox:${branch.id}`;
  const [device, setDevice] = useState<Device | null>(() => readJson<Device | null>(deviceKey, null));
  const [pending, setPending] = useState<readonly PendingInvoice[]>([]);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const pendingRef = useRef<readonly PendingInvoice[]>([]);
  const syncingRef = useRef(false);
  const numbersKey = device ? `numbers:${branch.id}:${device.id}` : null;

  const savePending = useCallback(
    async (next: readonly PendingInvoice[]) => {
      pendingRef.current = next;
      setPending(next);
      await idbSet(outboxKey, next);
    },
    [outboxKey],
  );

  useEffect(() => {
    void idbGet<PendingInvoice[]>(outboxKey).then((saved) => {
      pendingRef.current = saved ?? [];
      setPending(pendingRef.current);
    });
  }, [outboxKey]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  /** Registers the phone the first time and keeps enough invoice numbers in reserve. */
  const prepare = useCallback(async () => {
    let current = readJson<Device | null>(deviceKey, null);
    if (!current) {
      const registered = unwrap(await supabase.rpc('register_device')) as { id: string; number: number };
      current = { id: registered.id, number: registered.number };
      writeJson(deviceKey, current);
      setDevice(current);
    }
    const key = `numbers:${branch.id}:${current.id}`;
    const numbers = readJson<NumberBlocks>(key, { blocks: [], cursor: 0 });
    if (remainingNumbers(numbers) < REFILL_BELOW) {
      const block = unwrap(
        await supabase.rpc('reserve_invoice_numbers', { p_device_id: current.id, p_count: BLOCK_SIZE }),
      ) as { first_seq: number; last_seq: number };
      const latest = readJson<NumberBlocks>(key, numbers);
      writeJson(key, { ...latest, blocks: [...latest.blocks, { first: block.first_seq, last: block.last_seq }] });
    }
  }, [branch.id, deviceKey]);

  const syncNow = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      await prepare();
      let queue = pendingRef.current;
      for (const item of [...queue]) {
        try {
          await supabase.rpc('sync_invoice', { p_invoice: item.payload }).then(unwrap);
          queue = queue.filter((other) => other.payload.number !== item.payload.number);
        } catch (error) {
          const code = errorCode(error);
          if (code === 'OFFLINE') break;
          queue = queue.map((other) =>
            other.payload.number === item.payload.number ? { ...other, lastError: code } : other,
          );
        }
      }
      await savePending(queue);
      const current = readJson<Device | null>(deviceKey, null);
      if (current) {
        await supabase.rpc('device_heartbeat', { p_device_id: current.id, p_pending: queue.length });
      }
      setLastSyncedAt(new Date().toISOString());
    } catch {
      // Offline or server unreachable: try again on the next tick.
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [deviceKey, prepare, savePending]);

  useEffect(() => {
    void syncNow();
    const timer = window.setInterval(() => void syncNow(), SYNC_EVERY_MS);
    window.addEventListener('online', syncNow);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', syncNow);
    };
  }, [syncNow]);

  const takeNumber = useCallback(() => {
    if (!numbersKey) return null;
    const numbers = readJson<NumberBlocks>(numbersKey, { blocks: [], cursor: 0 });
    const seq = nextNumber(numbers);
    if (seq === null) return null;
    // Saved before the invoice exists, so a crash can never reuse the number.
    writeJson(numbersKey, { ...numbers, cursor: seq });
    if (remainingNumbers({ ...numbers, cursor: seq }) < REFILL_BELOW) void syncNow();
    return { number: formatInvoiceNumber({ branchCode: branch.code, seq }), seq };
  }, [branch.code, numbersKey, syncNow]);

  const enqueue = useCallback(
    async (payload: InvoicePayload) => {
      await savePending([...pendingRef.current, { payload, lastError: null }]);
      void syncNow();
    },
    [savePending, syncNow],
  );

  return { device, pending, online, syncing, lastSyncedAt, takeNumber, enqueue, syncNow };
}
