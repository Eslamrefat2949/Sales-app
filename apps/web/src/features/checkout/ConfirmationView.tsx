import type { Invoice } from '@ravin-sales/domain';
import { Price } from '../../components/Price.tsx';
import { PAYMENT_METHODS } from '../../config/demo.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';

/** The customer photographs this screen, so the invoice number dominates it. */
export function ConfirmationView({
  invoice,
  onNewSale,
}: {
  readonly invoice: Invoice;
  readonly onNewSale: () => void;
}) {
  const { t, lang } = useI18n();
  const methodLabel = (code: string) => PAYMENT_METHODS.find((method) => method.code === code)?.label[lang] ?? code;

  return (
    <div className="gutter mx-auto flex max-w-xl flex-col gap-5 pt-6 pb-10">
      <p className="text-center font-semibold text-free">{t.invoiceSaved}</p>

      <section className="flex flex-col items-center gap-2 rounded-3xl border-2 border-fg bg-surface px-4 py-8 text-center">
        <span className="text-sm tracking-wide text-muted uppercase">{t.invoiceNumber}</span>
        <bdi
          dir="ltr"
          className="font-mono text-[clamp(1.75rem,9vw,3rem)] leading-tight font-semibold tracking-wider break-all select-all"
        >
          {invoice.number}
        </bdi>
        <span className="text-lg font-semibold">
          <Price amount={invoice.totals.total} />
        </span>
        <p className="text-sm text-muted">{t.photoHint}</p>
      </section>

      {invoice.change > 0 ? (
        <div className="flex items-baseline justify-between rounded-2xl bg-promo-bg p-4 text-promo">
          <span className="font-semibold">{t.giveChange}</span>
          <span className="text-2xl font-bold">
            <Price amount={invoice.change} />
          </span>
        </div>
      ) : null}

      <ul className="flex flex-col gap-1 rounded-2xl bg-surface p-4">
        {invoice.payments.map((payment) => (
          <li key={payment.methodCode} className="flex justify-between">
            <span>{methodLabel(payment.methodCode)}</span>
            <Price amount={payment.amount} />
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onNewSale}
        autoFocus
        className="min-h-14 rounded-2xl bg-accent px-6 text-lg font-semibold text-accent-fg"
      >
        {t.newSale}
      </button>
      <p className="text-center text-xs text-muted">{t.demoSavedLocally}</p>
    </div>
  );
}
