import type { Money } from '@ravin-sales/domain';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { formatMoney } from '../lib/format.ts';

/** Amount with currency, kept left-to-right inside Arabic text. */
export function Price({ amount, className = '' }: { readonly amount: Money; readonly className?: string }) {
  const { t } = useI18n();
  return (
    <bdi className={`tabular whitespace-nowrap ${className}`}>
      {formatMoney(amount)} <span className="text-[0.72em] font-normal opacity-70">{t.currency}</span>
    </bdi>
  );
}

/** Item code (and size) in the code face, always left-to-right. */
export function Code({ children, className = '' }: { readonly children: string; readonly className?: string }) {
  return (
    <bdi dir="ltr" className={`font-mono tracking-wide ${className}`}>
      {children}
    </bdi>
  );
}
