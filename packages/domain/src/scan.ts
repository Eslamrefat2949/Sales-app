import { normalizeDigits } from './text.ts';

/**
 * Normalizes a scanned or typed barcode for an exact lookup: Latin digits, no spaces, upper case.
 * Barcodes are never split on the dash, because item codes or sizes (e.g. "2-3Y") can contain one.
 */
export function normalizeBarcode(raw: string): string {
  return normalizeDigits(raw).replace(/\s+/g, '').toUpperCase();
}

/** Barcode printed on tags when the item list does not provide one: ITEMCODE-SIZE. */
export function defaultBarcode(itemCode: string, size: string): string {
  return normalizeBarcode(`${itemCode}-${size}`);
}

/**
 * The camera sees the same label many times per second. The gate accepts a code once, then ignores
 * the same code until `cooldownMs` has passed; a different code is accepted at once. To sell two
 * identical pieces the seller moves the phone away and scans again (or taps +).
 */
export function createScanGate(cooldownMs: number): (code: string, nowMs: number) => boolean {
  let lastCode: string | null = null;
  let lastAt = Number.NEGATIVE_INFINITY;
  return (code, nowMs) => {
    if (code === lastCode && nowMs - lastAt < cooldownMs) {
      lastAt = nowMs; // still in view: keep ignoring until it has been away for the full cooldown
      return false;
    }
    lastCode = code;
    lastAt = nowMs;
    return true;
  };
}
