import { normalizeEgyptianMobile, settlePayments, type PaymentLine, type PricedCart } from '@ravin-sales/domain';
import { useMemo, useState, type ReactNode } from 'react';
import { Price } from '../../components/Price.tsx';
import { EMPLOYEES, PAYMENT_METHODS } from '../../config/demo.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { formatMoney, moneyToInput, parseAmount } from '../../lib/format.ts';
import { readJson, writeJson } from '../../lib/storage.ts';

export interface CheckoutResult {
  readonly salesPersonId: string;
  readonly customer: { readonly mobile: string; readonly name: string };
  readonly payments: readonly PaymentLine[];
  readonly change: number;
}

interface CheckoutViewProps {
  readonly priced: PricedCart;
  readonly knownCustomers: ReadonlyMap<string, string>;
  readonly onBack: () => void;
  readonly onConfirm: (result: CheckoutResult) => void;
}

export function CheckoutView({ priced, knownCustomers, onBack, onConfirm }: CheckoutViewProps) {
  const { t, lang } = useI18n();
  const total = priced.totals.total;
  const [salesPersonId, setSalesPersonId] = useState(() => readJson<string>('last-sales-person', ''));
  const [mobileInput, setMobileInput] = useState('');
  const [name, setName] = useState('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const mobile = normalizeEgyptianMobile(mobileInput);
  const knownName = mobile ? knownCustomers.get(mobile) : undefined;

  const parsed = useMemo(() => {
    const lines: PaymentLine[] = [];
    for (const method of PAYMENT_METHODS) {
      const amount = parseAmount(amounts[method.code] ?? '');
      if (amount === null) return null;
      lines.push({ methodCode: method.code, amount });
    }
    return lines;
  }, [amounts]);
  const settlement = parsed ? settlePayments(total, parsed, PAYMENT_METHODS) : null;
  const tendered = parsed?.reduce((sum, line) => sum + line.amount, 0) ?? 0;

  const fillRest = (code: string) => {
    const others = (parsed ?? []).filter((line) => line.methodCode !== code).reduce((sum, line) => sum + line.amount, 0);
    setAmounts((current) => ({ ...current, [code]: moneyToInput(Math.max(0, total - others)) }));
  };

  const blocker = !salesPersonId
    ? t.needSalesPerson
    : !mobile
      ? t.needMobile
      : name.trim() === '' && !knownName
        ? t.needName
        : null;
  const canConfirm = blocker === null && settlement?.ok === true;

  const paymentStatus = !settlement ? (
    <span className="text-danger">{t.invalidAmount}</span>
  ) : settlement.ok ? (
    settlement.change > 0 ? (
      <span className="font-semibold text-promo">{t.changeDue(`${formatMoney(settlement.change)} ${t.currency}`)}</span>
    ) : (
      <span className="font-semibold text-free">{t.paidExact}</span>
    )
  ) : settlement.reason === 'OVERPAID_WITHOUT_CASH' ? (
    <span className="text-danger">{t.overpaidNonCash(`${formatMoney(settlement.difference)} ${t.currency}`)}</span>
  ) : (
    <span className="text-muted">{t.stillToCollect(`${formatMoney(settlement.difference)} ${t.currency}`)}</span>
  );

  return (
    <form
      className="gutter mx-auto flex max-w-xl flex-col gap-5 pt-4 pb-10"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canConfirm || !settlement?.ok || !mobile) return;
        writeJson('last-sales-person', salesPersonId);
        onConfirm({
          salesPersonId,
          customer: { mobile, name: name.trim() || knownName || '' },
          payments: settlement.payments,
          change: settlement.change,
        });
      }}
    >
      <button type="button" onClick={onBack} className="self-start text-sm font-medium text-accent">
        {lang === 'ar' ? '→' : '←'} {t.backToCart}
      </button>

      <div className="rounded-3xl bg-accent p-5 text-accent-fg">
        <div className="text-sm opacity-80">
          {t.total} · {t.pieces(priced.totals.unitCount)}
        </div>
        <div className="tabular text-4xl font-bold">
          {formatMoney(total)} <span className="text-lg font-medium">{t.currency}</span>
        </div>
      </div>

      <Field id="sales-person" label={t.salesPerson}>
        <select
          id="sales-person"
          value={salesPersonId}
          onChange={(event) => setSalesPersonId(event.target.value)}
          className="h-13 w-full rounded-2xl border-2 border-line bg-surface px-3 text-base"
        >
          <option value="">{t.choose}</option>
          {EMPLOYEES.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name}
            </option>
          ))}
        </select>
      </Field>

      <Field id="customer-mobile" label={t.customerMobile} hint={mobileInput && !mobile ? t.mobileHint : null}>
        <input
          id="customer-mobile"
          value={mobileInput}
          onChange={(event) => setMobileInput(event.target.value)}
          inputMode="tel"
          autoComplete="off"
          dir="ltr"
          placeholder="01XXXXXXXXX"
          className="tabular h-13 w-full rounded-2xl border-2 border-line bg-surface px-3 font-mono text-lg tracking-wider focus:border-accent focus:outline-none"
        />
      </Field>

      <Field id="customer-name" label={t.customerName} hint={knownName ? `${t.returningCustomer}: ${knownName}` : null}>
        <input
          id="customer-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="off"
          placeholder={knownName ?? ''}
          className="h-13 w-full rounded-2xl border-2 border-line bg-surface px-3 text-base focus:border-accent focus:outline-none"
        />
      </Field>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium text-muted">{t.payment}</legend>
        {PAYMENT_METHODS.map((method) => (
          <div key={method.code} className="flex items-center gap-2 rounded-2xl bg-surface p-2 ps-4">
            <label htmlFor={`pay-${method.code}`} className="w-24 shrink-0 font-semibold">
              {method.label[lang]}
            </label>
            <input
              id={`pay-${method.code}`}
              aria-label={t.amountFor(method.label[lang])}
              value={amounts[method.code] ?? ''}
              onChange={(event) => setAmounts((current) => ({ ...current, [method.code]: event.target.value }))}
              inputMode="decimal"
              autoComplete="off"
              dir="ltr"
              placeholder="0"
              className="tabular h-12 min-w-0 flex-1 rounded-xl border-2 border-line bg-bg px-3 font-mono text-lg focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={() => fillRest(method.code)}
              className="h-12 shrink-0 rounded-xl bg-surface-2 px-3 text-sm font-semibold"
            >
              {t.fillRest}
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-1 text-sm" aria-live="polite">
          {paymentStatus}
          {tendered > 0 ? <Price amount={tendered} className="text-muted" /> : null}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        {blocker ? <p className="text-center text-sm text-muted">{blocker}</p> : null}
        <button
          type="submit"
          disabled={!canConfirm}
          className="min-h-14 rounded-2xl bg-accent px-6 text-lg font-semibold text-accent-fg disabled:opacity-40"
        >
          {t.confirmInvoice}
        </button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  hint = null,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint?: string | null;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-muted">
        {label}
      </label>
      {children}
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}
