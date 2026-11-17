import { sortSizes, type CartUnit } from '@ravin-sales/domain';
import { useMemo } from 'react';
import { Code, Price } from '../../components/Price.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import type { CatalogItem, CatalogVariant } from '../../config/demo.ts';
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
      title={item.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3">
          <Code>{item.itemCode}</Code>
          {first ? (
            <span className="flex items-center gap-2">
              <Price amount={first.salePrice} className="font-semibold text-fg" />
              <s className="text-muted">
                <Price amount={first.listPrice} />
              </s>
            </span>
          ) : null}
        </span>
      }
      closeLabel={t.done}
      onClose={onClose}
    >
      <p className="mb-3 text-sm text-muted">{t.sizeHint}</p>
      <div className="grid grid-cols-3 gap-2 pb-1 sm:grid-cols-4">
        {variants.map((variant) => {
          const count = cartUnits.filter(
            (unit) => unit.itemCode === item.itemCode && unit.size === variant.size,
          ).length;
          return (
            <button
              key={variant.size}
              type="button"
              onClick={() => onAdd(variant)}
              className={`relative flex min-h-16 items-center justify-center rounded-2xl border-2 px-2 text-lg font-semibold transition active:scale-95 ${
                count > 0 ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-surface-2 text-fg'
              }`}
            >
              <Code>{variant.size}</Code>
              {count > 0 ? (
                <span className="tabular absolute -top-2 end-1 min-w-6 rounded-full bg-free px-1.5 text-center text-xs leading-6 font-bold text-surface">
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
