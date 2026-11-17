import JsBarcode from 'jsbarcode';
import { useEffect, useMemo, useRef } from 'react';
import { Sheet } from '../../components/Sheet.tsx';
import type { Catalog } from '../../data/appData.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';

function Barcode({ value }: { readonly value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    // Black bars on white whatever the theme: scanners need that contrast.
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

/** Real barcodes from the item list, to try the scanner from another screen during training. */
export function TestBarcodesSheet({ catalog, onClose }: { readonly catalog: Catalog; readonly onClose: () => void }) {
  const { t } = useI18n();
  const samples = useMemo(() => {
    const step = Math.max(1, Math.floor(catalog.items.length / 8));
    return catalog.items
      .filter((_, index) => index % step === 0)
      .slice(0, 8)
      .map((item) => ({ item, variant: item.variants[Math.min(1, item.variants.length - 1)]! }));
  }, [catalog]);

  return (
    <Sheet title={t.testBarcodes} subtitle={t.testBarcodesHint} closeLabel={t.close} onClose={onClose}>
      <ul className="grid gap-3 pb-2 sm:grid-cols-2">
        {samples.map(({ item, variant }) => (
          <li key={variant.barcode} className="flex flex-col items-center gap-1 rounded-2xl bg-surface-2 p-3">
            <div className="overflow-x-auto rounded-xl">
              <Barcode value={variant.barcode} />
            </div>
            <span className="text-sm text-muted">
              {item.itemCode} · {variant.size}
            </span>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
