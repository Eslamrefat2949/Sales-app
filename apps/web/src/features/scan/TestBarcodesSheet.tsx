import JsBarcode from 'jsbarcode';
import { useEffect, useRef } from 'react';
import { Sheet } from '../../components/Sheet.tsx';
import { CATALOG } from '../../config/demo.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';

/** A handful of demo pieces with real Code 128 barcodes, to try the scanner from another screen. */
const SAMPLES = CATALOG.filter((_, index) => index % 4 === 0)
  .slice(0, 8)
  .map((item) => ({ item, variant: item.variants[Math.min(2, item.variants.length - 1)]! }));

function Barcode({ value }: { readonly value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    // Black bars on white, whatever the theme: scanners need that contrast.
    JsBarcode(ref.current, value, {
      format: 'CODE128',
      height: 70,
      width: 2,
      margin: 12,
      fontSize: 16,
      font: 'IBM Plex Mono, monospace',
      background: '#ffffff',
      lineColor: '#000000',
    });
  }, [value]);
  return <svg ref={ref} role="img" aria-label={value} className="h-auto max-w-full" />;
}

export function TestBarcodesSheet({ onClose }: { readonly onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet title={t.testBarcodes} subtitle={t.testBarcodesHint} closeLabel={t.close} onClose={onClose}>
      <ul className="grid gap-3 pb-2 sm:grid-cols-2">
        {SAMPLES.map(({ item, variant }) => (
          <li key={variant.barcode} className="flex flex-col items-center gap-1 rounded-2xl bg-surface-2 p-3">
            <div className="overflow-x-auto rounded-xl">
              <Barcode value={variant.barcode} />
            </div>
            <span className="text-sm text-muted">
              {item.name} · {variant.size}
            </span>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
