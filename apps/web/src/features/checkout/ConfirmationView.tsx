import type { Invoice } from '@ravin-sales/domain';
import { Icon } from '../../components/Icon.tsx';
import { Price } from '../../components/Price.tsx';
import type { AppConfig } from '../../data/appData.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';

/** The customer photographs this receipt, so the invoice number dominates it. */
export function ConfirmationView({
  config,
  invoice,
  onNewSale,
}: {
  readonly config: AppConfig;
  readonly invoice: Invoice;
  readonly onNewSale: () => void;
}) {
  const { t, lang } = useI18n();
  const methodLabel = (code: string) =>
    config.paymentMethods.find((method) => method.code === code)?.label[lang] ?? code;

  return (
    <div className="gutter mx-auto flex max-w-md flex-col gap-5 pt-6 pb-10">
      <div className="animate-pop flex flex-col items-center gap-2 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-free text-white shadow-card">
          <Icon name="check" className="h-9 w-9" />
        </span>
        <p className="font-display text-xl font-semibold text-free">{t.invoiceSaved}</p>
      </div>

      <section className="ticket animate-rise flex flex-col gap-3 rounded-3xl bg-surface px-5 py-6 text-center shadow-card">
        <span className="text-sm font-medium text-muted">{t.invoiceNumber}</span>
        <bdi
          dir="ltr"
          className="font-mono text-[clamp(1.6rem,8.5vw,2.6rem)] leading-tight font-semibold tracking-wider break-all text-primary select-all"
        >
          {invoice.number}
        </bdi>
        <p className="text-sm text-muted">{t.photoHint}</p>
        <div className="my-2 border-t-2 border-dashed border-line" />
        <div className="flex items-baseline justify-between">
          <span className="text-muted">{t.total}</span>
          <span className="font-display text-2xl font-semibold">
            <Price amount={invoice.totals.total} />
          </span>
        </div>
        <ul className="flex flex-col gap-1 text-sm">
          {invoice.payments.map((payment) => (
            <li key={payment.methodCode} className="flex justify-between">
              <span>{methodLabel(payment.methodCode)}</span>
              <Price amount={payment.amount} />
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">{t.pieces(invoice.totals.unitCount)}</p>
      </section>

      {invoice.change > 0 ? (
        <div className="animate-pop flex items-baseline justify-between rounded-2xl bg-tile-amber p-4 text-tile-amber-fg">
          <span className="font-semibold">{t.giveChange}</span>
          <span className="font-display text-2xl font-semibold">
            <Price amount={invoice.change} />
          </span>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onNewSale}
        autoFocus
        className="press flex min-h-15 items-center justify-center gap-2 rounded-2xl bg-primary px-6 text-lg font-semibold text-primary-fg shadow-card"
      >
        <Icon name="plus" />
        {t.newSale}
      </button>
      <p className="text-center text-xs text-muted">{t.savedWillSync}</p>
    </div>
  );
}
