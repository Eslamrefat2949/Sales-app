import { describe, expect, it } from 'vitest';
import { createScanGate, defaultBarcode, normalizeBarcode } from '../src/scan.ts';

describe('barcodes', () => {
  it('builds the ITEMCODE-SIZE tag barcode, keeping dashes inside sizes', () => {
    expect(defaultBarcode('A10234', 'M')).toBe('A10234-M');
    expect(defaultBarcode('K50101', '2-3Y')).toBe('K50101-2-3Y');
  });

  it('normalizes what a scanner or keyboard produced', () => {
    expect(normalizeBarcode(' a10234-m ')).toBe('A10234-M');
    expect(normalizeBarcode('A١٠٢٣٤-M')).toBe('A10234-M');
  });
});

describe('createScanGate', () => {
  it('accepts a code once while it stays in front of the camera', () => {
    const accept = createScanGate(1500);
    expect(accept('A10234-M', 0)).toBe(true);
    expect(accept('A10234-M', 200)).toBe(false);
    expect(accept('A10234-M', 1600)).toBe(false); // seen again at 200, so the window restarted
  });

  it('accepts the same code again after it has been away for the cooldown', () => {
    const accept = createScanGate(1500);
    expect(accept('A10234-M', 0)).toBe(true);
    expect(accept('A10234-M', 1500)).toBe(true);
  });

  it('accepts a different code immediately', () => {
    const accept = createScanGate(1500);
    expect(accept('A10234-M', 0)).toBe(true);
    expect(accept('B20114-32', 100)).toBe(true);
    expect(accept('A10234-M', 200)).toBe(true);
  });
});
