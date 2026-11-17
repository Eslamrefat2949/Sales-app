import { normalizeBarcode, searchCatalog, type CartState, type PricedCart, type PricedUnit } from '@ravin-sales/domain';
import { useMemo, useRef, useState } from 'react';
import { Code, Price } from '../../components/Price.tsx';
import {
  ACTIVE_OFFER,
  BARCODE_INDEX,
  CATALOG,
  CATALOG_BY_CODE,
  type CatalogItem,
  type CatalogVariant,
} from '../../config/demo.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { tick } from '../../lib/storage.ts';
import type { CartAction } from '../../state/cart.ts';
import { ScannerView, type ScanOutcome } from '../scan/ScannerView.tsx';
import { TestBarcodesSheet } from '../scan/TestBarcodesSheet.tsx';
import { OfferSheet } from './OfferSheet.tsx';
import { SizeSheet } from './SizeSheet.tsx';

interface SellViewProps {
  readonly cart: CartState;
  readonly priced: PricedCart;
  readonly dispatch: (action: CartAction) => void;
  readonly onCheckout: () => void;
  readonly notify: (message: string) => void;
}

export function SellView({ cart, priced, dispatch, onCheckout, notify }: SellViewProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [offerOpen, setOfferOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [testBarcodesOpen, setTestBarcodesOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const addVariant = (item: CatalogItem, variant: CatalogVariant) => {
    dispatch({
      type: 'add',
      unit: {
        barcode: variant.barcode,
        itemCode: item.itemCode,
        size: variant.size,
        listPrice: variant.listPrice,
        salePrice: variant.salePrice,
        discountable: item.discountable,
      },
    });
  };

  /** Shared by the camera, Bluetooth/USB scanners and a barcode typed in the search box. */
  const addByBarcode = (raw: string): ScanOutcome => {
    const code = normalizeBarcode(raw);
    const match = BARCODE_INDEX.get(code);
    if (!match) return { ok: false, message: t.unknownBarcode(code) };
    addVariant(match.item, match.variant);
    return { ok: true, message: t.added(match.item.itemCode, match.variant.size) };
  };

  const results = useMemo(() => searchCatalog(CATALOG, query, 12), [query]);
  const searching = query.trim() !== '';
  const { totals } = priced;

  const closeSizes = () => {
    setSelected(null);
    setQuery('');
    searchRef.current?.focus();
  };

  const removePiece = (seq: number) => {
    if (cart.offer && seq <= cart.offer.appliedAtSeq) notify(t.offerRemovedToast);
    dispatch({ type: 'remove', seq });
  };

  return (
    <>
      <div className="gutter flex flex-col gap-4 pt-4 pb-40">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor="item-search" className="text-sm font-medium text-muted">
              {t.searchLabel}
            </label>
            <button type="button" onClick={() => setTestBarcodesOpen(true)} className="text-sm font-medium text-accent">
              {t.testBarcodes}
            </button>
          </div>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                id="item-search"
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  // Bluetooth/USB scanners type the barcode and press Enter.
                  if (BARCODE_INDEX.has(normalizeBarcode(query))) {
                    const outcome = addByBarcode(query);
                    tick();
                    notify(outcome.message);
                    setQuery('');
                  } else if (results[0]) {
                    setSelected(results[0]);
                  }
                }}
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                dir="ltr"
                placeholder={t.searchPlaceholder}
                className="h-14 w-full rounded-2xl border-2 border-line bg-surface ps-4 pe-12 font-mono text-xl tracking-wider placeholder:font-sans placeholder:text-base placeholder:tracking-normal placeholder:text-muted focus:border-accent focus:outline-none"
              />
              {searching ? (
                <button
                  type="button"
                  aria-label={t.clearSearch}
                  onClick={() => {
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                  className="absolute inset-y-0 end-2 my-auto h-10 w-10 rounded-full text-2xl leading-none text-muted"
                >
                  ×
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              className="flex h-14 shrink-0 items-center gap-2 rounded-2xl bg-accent px-4 font-semibold text-accent-fg"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
                <path d="M8 9v6M11 9v6M14 9v6M17 9v6" />
              </svg>
              {t.scan}
            </button>
          </div>
        </div>

        {searching ? (
          <SearchResults query={query} results={results} onPick={setSelected} />
        ) : (
          <CartList priced={priced} onRemove={removePiece} onClear={() => dispatch({ type: 'clear' })} />
        )}
      </div>

      <div className="gutter pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pt-3 shadow-[0_-8px_24px_-16px_var(--scrim)]">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted">
              {t.total} · {t.pieces(totals.unitCount)}
            </div>
            <div className="text-2xl leading-tight font-bold">
              <Price amount={totals.total} />
            </div>
            {totals.defaultDiscountTotal + totals.offerDiscountTotal > 0 ? (
              <div className="text-xs text-free">
                {t.discount} <Price amount={totals.defaultDiscountTotal + totals.offerDiscountTotal} />
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setOfferOpen(true)}
            disabled={totals.unitCount === 0}
            className={`min-h-13 rounded-2xl border-2 px-4 font-semibold disabled:opacity-40 ${
              cart.offer ? 'border-paid bg-paid-bg text-paid' : 'border-line'
            }`}
          >
            {cart.offer ? t.offerOn : t.offer}
          </button>
          <button
            type="button"
            onClick={onCheckout}
            disabled={totals.unitCount === 0}
            className="min-h-13 rounded-2xl bg-accent px-6 font-semibold text-accent-fg disabled:opacity-40"
          >
            {t.checkout}
          </button>
        </div>
      </div>

      {selected ? (
        <SizeSheet
          item={selected}
          cartUnits={cart.units}
          onAdd={(variant) => {
            addVariant(selected, variant);
            tick();
            notify(t.added(selected.itemCode, variant.size));
          }}
          onClose={closeSizes}
        />
      ) : null}

      {scannerOpen ? (
        <ScannerView
          onBarcode={addByBarcode}
          onClose={() => setScannerOpen(false)}
          pieceCount={totals.unitCount}
          total={totals.total}
        />
      ) : null}

      {testBarcodesOpen ? <TestBarcodesSheet onClose={() => setTestBarcodesOpen(false)} /> : null}

      {offerOpen ? (
        <OfferSheet
          cart={cart}
          onApply={() => {
            dispatch({ type: 'applyOffer', offer: ACTIVE_OFFER });
            setOfferOpen(false);
          }}
          onRemove={() => {
            dispatch({ type: 'removeOffer' });
            setOfferOpen(false);
          }}
          onClose={() => setOfferOpen(false)}
        />
      ) : null}
    </>
  );
}

function SearchResults({
  query,
  results,
  onPick,
}: {
  readonly query: string;
  readonly results: readonly CatalogItem[];
  readonly onPick: (item: CatalogItem) => void;
}) {
  const { t } = useI18n();
  if (results.length === 0) {
    return <p className="rounded-2xl bg-surface p-4 text-center text-muted">{t.noResults(query.trim())}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {results.map((item) => {
        const variant = item.variants[0];
        return (
          <li key={item.itemCode}>
            <button
              type="button"
              onClick={() => onPick(item)}
              className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-start active:bg-surface-2"
            >
              <div className="min-w-0 flex-1">
                <Code className="text-lg font-semibold">{item.itemCode}</Code>
                <div className="truncate text-sm text-muted">
                  {item.name} · {t.sizesCount(item.variants.length)}
                </div>
              </div>
              {variant ? (
                <div className="text-end">
                  <div className="font-semibold">
                    <Price amount={variant.salePrice} />
                  </div>
                  <s className="text-xs text-muted">
                    <Price amount={variant.listPrice} />
                  </s>
                </div>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const TREATMENT_STYLE: Record<PricedUnit['treatment'], string> = {
  default_discount: 'bg-promo-bg text-promo',
  offer_paid: 'bg-paid-bg text-paid',
  offer_free: 'bg-free-bg text-free',
  no_discount: 'bg-surface-2 text-muted',
};

function CartList({
  priced,
  onRemove,
  onClear,
}: {
  readonly priced: PricedCart;
  readonly onRemove: (seq: number) => void;
  readonly onClear: () => void;
}) {
  const { t } = useI18n();
  if (priced.units.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-line p-6 text-center">
        <p className="font-semibold">{t.cartEmptyTitle}</p>
        <p className="mt-1 text-sm text-muted">{t.cartEmptyHint}</p>
      </div>
    );
  }

  const label = (unit: PricedUnit) =>
    unit.treatment === 'offer_free'
      ? t.treatmentFree
      : unit.treatment === 'offer_paid'
        ? t.treatmentPaid
        : unit.treatment === 'no_discount'
          ? t.treatmentNoDiscount
          : t.treatmentDefault(unit.discountPercent);

  return (
    <section className="flex flex-col gap-2" aria-label={t.cart}>
      <header className="flex items-baseline justify-between">
        <h2 className="font-semibold">
          {t.cart} <span className="text-sm font-normal text-muted">· {t.pieces(priced.units.length)}</span>
        </h2>
        <button type="button" onClick={onClear} className="text-sm font-medium text-danger">
          {t.clearCart}
        </button>
      </header>
      <ul className="flex flex-col gap-2">
        {[...priced.units].reverse().map((unit) => (
          <li key={unit.seq} className="flex items-center gap-3 rounded-2xl bg-surface p-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Code className="font-semibold">{`${unit.itemCode} · ${unit.size}`}</Code>
                <span className="truncate text-sm text-muted">{CATALOG_BY_CODE.get(unit.itemCode)?.name}</span>
              </div>
              <span
                className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${TREATMENT_STYLE[unit.treatment]}`}
              >
                {label(unit)}
              </span>
            </div>
            <div className="text-end">
              <div className="font-semibold">
                <Price amount={unit.finalPrice} />
              </div>
              {unit.finalPrice !== unit.salePrice ? (
                <s className="text-xs text-muted">
                  <Price amount={unit.salePrice} />
                </s>
              ) : null}
            </div>
            <button
              type="button"
              aria-label={t.removePiece(unit.itemCode, unit.size)}
              onClick={() => onRemove(unit.seq)}
              className="h-10 w-10 shrink-0 rounded-full bg-surface-2 text-xl leading-none text-muted"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
