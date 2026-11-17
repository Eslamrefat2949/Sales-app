import {
  applyDiscount,
  normalizeBarcode,
  searchCatalog,
  type CartState,
  type PricedCart,
  type PricedUnit,
} from '@ravin-sales/domain';
import { useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { Code, Price } from '../../components/Price.tsx';
import { AnimatedMoney } from '../../components/Tiles.tsx';
import { useNotify } from '../../components/Toast.tsx';
import type { AppConfig, Catalog, CatalogItem, CatalogVariant } from '../../data/appData.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { tick } from '../../lib/storage.ts';
import type { CartAction } from '../../state/cart.ts';
import { ScannerView, type ScanMatch } from '../scan/ScannerView.tsx';
import { TestBarcodesSheet } from '../scan/TestBarcodesSheet.tsx';
import { OfferSheet } from './OfferSheet.tsx';
import { SizeSheet } from './SizeSheet.tsx';

interface SellViewProps {
  readonly config: AppConfig;
  readonly catalog: Catalog;
  readonly cart: CartState;
  readonly priced: PricedCart;
  readonly dispatch: (action: CartAction) => void;
  readonly onCheckout: () => void;
}

export function SellView({ config, catalog, cart, priced, dispatch, onCheckout }: SellViewProps) {
  const { t } = useI18n();
  const notify = useNotify();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [offerOpen, setOfferOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchCatalog(catalog.items, query, 12), [catalog, query]);
  const searching = query.trim() !== '';
  const { totals } = priced;

  const addVariant = (item: CatalogItem, variant: CatalogVariant) => {
    dispatch({
      type: 'add',
      unit: {
        barcode: variant.barcode,
        itemCode: item.itemCode,
        size: variant.size,
        listPrice: variant.listPrice,
        salePrice: variant.salePrice,
        discountable: variant.discountable,
      },
    });
    setLastAdded(variant.barcode);
  };

  const lookup = (code: string): ScanMatch | null => catalog.byBarcode.get(normalizeBarcode(code)) ?? null;

  const removePiece = (seq: number) => {
    const unit = cart.units.find((candidate) => candidate.seq === seq);
    if (cart.offer && unit?.discountable && seq <= cart.offer.appliedAtSeq) notify(t.offerRemovedToast);
    dispatch({ type: 'remove', seq });
  };

  const closeSizes = () => {
    setSelected(null);
    setQuery('');
    searchRef.current?.focus();
  };

  return (
    <>
      <div className="gutter flex flex-col gap-5 pt-5 pb-44">
        <button
          type="button"
          onClick={() => setScannerOpen(true)}
          className="press animate-rise flex items-center gap-4 rounded-3xl bg-surface p-4 text-start shadow-card"
        >
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-fg shadow-card">
            <Icon name="scan" className="h-9 w-9" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-xl font-semibold">{t.scanHero}</span>
            <span className="block text-sm text-muted">{t.scanHeroHint}</span>
          </span>
          <Icon name="back" className="h-5 w-5 text-muted ltr:rotate-180" />
        </button>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor="item-search" className="text-sm font-medium text-muted">
              {t.orType}
            </label>
            <button type="button" onClick={() => setTestOpen(true)} className="text-xs font-semibold text-primary">
              {t.testBarcodes}
            </button>
          </div>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 start-4 flex items-center text-muted">
              <Icon name="search" />
            </span>
            <input
              id="item-search"
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                // Bluetooth/USB scanners type the barcode and press Enter: add it straight away.
                const match = lookup(query);
                if (match) {
                  addVariant(match.item, match.variant);
                  tick();
                  notify(t.added(match.item.itemCode, match.variant.size), 'success');
                  setQuery('');
                } else if (results[0]) {
                  setSelected(results[0]);
                }
              }}
              inputMode="numeric"
              autoComplete="off"
              dir="ltr"
              placeholder={t.searchPlaceholder}
              aria-label={t.searchLabel}
              className="h-14 w-full rounded-2xl border border-line bg-surface ps-12 pe-12 font-mono text-lg tracking-wider shadow-card placeholder:font-sans placeholder:text-base placeholder:tracking-normal placeholder:text-muted focus:border-primary focus:outline-none"
            />
            {searching ? (
              <button
                type="button"
                aria-label={t.clearSearch}
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
                className="absolute inset-y-0 end-2 my-auto flex h-10 w-10 items-center justify-center rounded-full text-muted"
              >
                <Icon name="close" />
              </button>
            ) : null}
          </div>
        </div>

        {searching ? (
          <SearchResults query={query} results={results} onPick={setSelected} />
        ) : (
          <CartList
            priced={priced}
            lastAdded={lastAdded}
            onRemove={removePiece}
            onAddAnother={(unit) => {
              const match = lookup(unit.barcode);
              if (match) addVariant(match.item, match.variant);
            }}
            onClear={() => dispatch({ type: 'clear' })}
          />
        )}
      </div>

      <div className="gutter pb-safe fixed inset-x-0 bottom-0 z-20 pt-3">
        <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-3xl bg-surface p-3 shadow-[0_-4px_30px_-8px_rgb(15_27_45/0.25)]">
          <div className="min-w-0 flex-1 px-1">
            <div className="text-xs text-muted">
              {t.total} · {t.pieces(totals.unitCount)}
            </div>
            <div className="font-display text-2xl leading-tight font-semibold">
              <AnimatedMoney amount={totals.total} />{' '}
              <span className="text-sm font-normal text-muted">{t.currency}</span>
            </div>
            {totals.defaultDiscountTotal + totals.offerDiscountTotal > 0 ? (
              <div className="text-xs font-semibold text-free">
                {t.discount} <Price amount={totals.defaultDiscountTotal + totals.offerDiscountTotal} />
              </div>
            ) : null}
          </div>
          {config.offer ? (
            <button
              type="button"
              onClick={() => setOfferOpen(true)}
              disabled={totals.unitCount === 0}
              className={`press h-13 rounded-2xl px-4 text-sm font-semibold disabled:opacity-40 ${
                cart.offer ? 'bg-paid-bg text-paid ring-2 ring-paid' : 'bg-surface-2 text-fg'
              }`}
            >
              {cart.offer ? t.offerOn : t.offer}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCheckout}
            disabled={totals.unitCount === 0}
            className="press flex h-13 items-center gap-2 rounded-2xl bg-primary px-5 font-semibold text-primary-fg shadow-card disabled:opacity-40"
          >
            {t.checkout}
            <Icon name="back" className="h-4 w-4 ltr:rotate-180" />
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
            notify(t.added(selected.itemCode, variant.size), 'success');
          }}
          onClose={closeSizes}
        />
      ) : null}

      {scannerOpen ? (
        <ScannerView
          lookup={lookup}
          priceAfterDiscount={(variant) =>
            variant.discountable ? applyDiscount(variant.salePrice, config.defaultDiscountPercent) : null
          }
          inCart={(barcode) => cart.units.filter((unit) => unit.barcode === barcode).length}
          onConfirm={(match) => addVariant(match.item, match.variant)}
          onClose={() => setScannerOpen(false)}
          pieceCount={totals.unitCount}
          total={totals.total}
        />
      ) : null}

      {offerOpen && config.offer ? (
        <OfferSheet
          cart={cart}
          offer={config.offer}
          pricing={{ defaultDiscountPercent: config.defaultDiscountPercent }}
          onApply={() => {
            dispatch({ type: 'applyOffer', offer: config.offer! });
            setOfferOpen(false);
          }}
          onRemove={() => {
            dispatch({ type: 'removeOffer' });
            setOfferOpen(false);
          }}
          onClose={() => setOfferOpen(false)}
        />
      ) : null}

      {testOpen ? <TestBarcodesSheet catalog={catalog} onClose={() => setTestOpen(false)} /> : null}
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
    return <p className="rounded-2xl bg-surface p-5 text-center text-muted shadow-card">{t.noResults(query.trim())}</p>;
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {results.map((item, index) => {
        const variant = item.variants[0];
        return (
          <li key={item.itemCode} className="animate-rise" style={{ animationDelay: `${index * 25}ms` }}>
            <button
              type="button"
              onClick={() => onPick(item)}
              className="press flex w-full items-center gap-3 rounded-2xl bg-surface p-3.5 text-start shadow-card"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-tile-blue text-tile-blue-fg">
                <Icon name="tag" />
              </span>
              <div className="min-w-0 flex-1">
                <Code className="text-lg font-semibold">{item.itemCode}</Code>
                <div className="truncate text-sm text-muted">
                  {item.name ? `${item.name} · ` : ''}
                  {t.sizesCount(item.variants.length)}
                </div>
              </div>
              {variant ? (
                <div className="text-end">
                  <div className="font-display font-semibold text-primary">
                    <Price amount={variant.salePrice} />
                  </div>
                  {variant.listPrice > variant.salePrice ? (
                    <s className="text-xs text-muted">
                      <Price amount={variant.listPrice} />
                    </s>
                  ) : null}
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

interface CartGroup {
  readonly key: string;
  readonly units: readonly PricedUnit[];
}

/** Same piece (barcode) priced the same way is one line with a count, newest first. */
function groupUnits(units: readonly PricedUnit[]): CartGroup[] {
  const groups = new Map<string, PricedUnit[]>();
  for (const unit of units) {
    const key = `${unit.barcode}|${unit.treatment}|${unit.finalPrice}`;
    const group = groups.get(key);
    if (group) group.push(unit);
    else groups.set(key, [unit]);
  }
  return [...groups]
    .map(([key, grouped]) => ({ key, units: grouped }))
    .sort((a, b) => Math.max(...b.units.map((u) => u.seq)) - Math.max(...a.units.map((u) => u.seq)));
}

function CartList({
  priced,
  lastAdded,
  onRemove,
  onAddAnother,
  onClear,
}: {
  readonly priced: PricedCart;
  readonly lastAdded: string | null;
  readonly onRemove: (seq: number) => void;
  readonly onAddAnother: (unit: PricedUnit) => void;
  readonly onClear: () => void;
}) {
  const { t } = useI18n();
  const groups = useMemo(() => groupUnits(priced.units), [priced.units]);
  const items = new Set(priced.units.map((unit) => unit.itemCode)).size;

  if (priced.units.length === 0) {
    return (
      <div className="animate-rise flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-line px-6 py-10 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-tile-blue text-tile-blue-fg">
          <Icon name="receipt" className="h-7 w-7" />
        </span>
        <p className="font-display text-lg font-semibold">{t.cartEmptyTitle}</p>
        <p className="max-w-xs text-sm text-muted">{t.cartEmptyHint}</p>
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
    <section className="flex flex-col gap-3" aria-label={t.cart}>
      <header className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">
          {t.cart}{' '}
          <span className="rounded-full bg-primary-soft px-2.5 py-0.5 align-middle text-sm font-semibold text-primary">
            {t.pieces(priced.units.length)} · {items}
          </span>
        </h2>
        <button
          type="button"
          onClick={onClear}
          className="press flex items-center gap-1 text-sm font-semibold text-danger"
        >
          <Icon name="trash" className="h-4 w-4" />
          {t.clearCart}
        </button>
      </header>
      <ul className="flex flex-col gap-2.5">
        {groups.map(({ key, units }) => {
          const unit = units[units.length - 1]!;
          const count = units.length;
          return (
            <li
              key={key}
              className={`flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-card ${unit.barcode === lastAdded ? 'animate-flash' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Code className="font-semibold">{unit.itemCode}</Code>
                  <span className="rounded-lg bg-surface-2 px-2 py-0.5 font-mono text-sm font-semibold" dir="ltr">
                    {unit.size}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TREATMENT_STYLE[unit.treatment]}`}>
                    {label(unit)}
                  </span>
                  <span className="text-xs text-muted">
                    <Price amount={unit.finalPrice} />
                    {unit.finalPrice !== unit.salePrice ? (
                      <s className="ms-1">
                        <Price amount={unit.salePrice} />
                      </s>
                    ) : null}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="font-display font-semibold">
                  <Price amount={unit.finalPrice * count} />
                </span>
                <div className="flex items-center gap-1 rounded-full bg-surface-2 p-1" dir="ltr">
                  <button
                    type="button"
                    aria-label={t.removePiece(unit.itemCode, unit.size)}
                    onClick={() => onRemove(unit.seq)}
                    className="press flex h-8 w-8 items-center justify-center rounded-full bg-surface text-lg font-semibold shadow-sm"
                  >
                    −
                  </button>
                  <span key={count} className="animate-pop min-w-6 text-center font-display font-semibold tabular">
                    {count}
                  </span>
                  <button
                    type="button"
                    aria-label={`+ ${unit.itemCode} ${unit.size}`}
                    onClick={() => onAddAnother(unit)}
                    className="press flex h-8 w-8 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-fg"
                  >
                    +
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
