import { sortSizes, type CartUnit } from '@ravin-sales/domain';
import { useMemo } from 'react';
import { Code, Price } from '../../components/Price.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import type { CatalogItem, CatalogVariant } from '../../data/appData.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';

interface SizeSheetProps {
  readonly item: CatalogItem;
  readonly cartUnits: readonly CartUnit[];
  readonly onAdd: (variant: CatalogVariant) => void;
  readonly onClose: () => void;
}

/** Large size buttons. Each tap adds one piece; the badge shows how many of that size are in the cart. */
export function SizeSheet({ item, cartUnits, onAdd, onClose }: SizeSheetProps) {
  const { t } = useI18n();
  const variants = useMemo(() => {
    const bySize = new Map(item.variants.map((variant) => [variant.size, variant]));
    return sortSizes(item.variants.map((variant) => variant.size)).map((size) => bySize.get(size)!);
  }, [item]);
  const first = variants[0];

  return (
    <Sheet
      title={<Code>{item.itemCode}</Code>}
      subtitle={
        first ? (
          <span className="flex flex-wrap items-center gap-2">
            {item.name ? <span>{item.name}</span> : null}
            <Price amount={first.salePrice} className="font-semibold text-primary" />
            {first.listPrice > first.salePrice ? (
              <s>
                <Price amount={first.listPrice} />
              </s>
            ) : null}
          </span>
        ) : null
      }
      closeLabel={t.done}
      onClose={onClose}
    >
      <p className="mb-3 text-sm text-muted">{t.sizeHint}</p>
      <div className="grid grid-cols-3 gap-2.5 pb-2 sm:grid-cols-4">
        {variants.map((variant, index) => {
          const count = cartUnits.filter((unit) => unit.barcode === variant.barcode).length;
          return (
            <button
              key={variant.barcode}
              type="button"
              onClick={() => onAdd(variant)}
              style={{ animationDelay: `${index * 30}ms` }}
              className={`press animate-rise relative flex min-h-18 flex-col items-center justify-center gap-0.5 rounded-2xl px-2 font-semibold ${
                count > 0 ? 'bg-primary text-primary-fg shadow-card' : 'bg-surface-2 text-fg'
              }`}
            >
              <Code className="text-lg">{variant.size}</Code>
              {variant.salePrice !== first?.salePrice ? (
                <span className="text-xs opacity-80">
                  <Price amount={variant.salePrice} />
                </span>
              ) : null}
              {count > 0 ? (
                <span
                  key={count}
                  className="animate-pop tabular absolute -top-2 end-1 min-w-6 rounded-full bg-free px-1.5 text-center text-xs leading-6 font-bold text-white"
                >
                  ×{count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
