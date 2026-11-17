import { normalizeEgyptianMobile, settlePayments, type PaymentLine, type PricedCart } from '@ravin-sales/domain';
import { useMemo, useState, type ReactNode } from 'react';
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

interface PaymentRow {
  readonly id: number;
  readonly methodCode: string;
  readonly amount: string;
}

function defaultMethod(): string {
  const last = readJson<string>('last-payment-method', '');
  return PAYMENT_METHODS.some((method) => method.code === last) ? last : (PAYMENT_METHODS[0]?.code ?? '');
}

/** Parses the rows; the same method chosen twice is added up into one payment. Null if an amount is invalid. */
function toPaymentLines(rows: readonly PaymentRow[]): PaymentLine[] | null {
  const byMethod = new Map<string, number>();
  for (const row of rows) {
    const amount = parseAmount(row.amount);
    if (amount === null) return null;
    byMethod.set(row.methodCode, (byMethod.get(row.methodCode) ?? 0) + amount);
  }
  return [...byMethod].map(([methodCode, amount]) => ({ methodCode, amount }));
}

export function CheckoutView({ priced, knownCustomers, onBack, onConfirm }: CheckoutViewProps) {
  const { t, lang } = useI18n();
  const total = priced.totals.total;
  const [salesPersonId, setSalesPersonId] = useState(() => readJson<string>('last-sales-person', ''));
  const [mobileInput, setMobileInput] = useState('');
  const [name, setName] = useState('');
  // Most sales are paid in full with one method: the row starts with the whole amount filled in.
  const [rows, setRows] = useState<readonly PaymentRow[]>(() => [
    { id: 1, methodCode: defaultMethod(), amount: moneyToInput(total) },
  ]);

  const mobile = normalizeEgyptianMobile(mobileInput);
  const mobileInvalid = mobileInput.trim() !== '' && mobile === null;
  const knownName = mobile ? knownCustomers.get(mobile) : undefined;

  const lines = useMemo(() => toPaymentLines(rows), [rows]);
  const settlement = lines ? settlePayments(total, lines, PAYMENT_METHODS) : null;
  const methodLabel = (code: string) => PAYMENT_METHODS.find((method) => method.code === code)?.label[lang] ?? code;

  const updateRow = (id: number, patch: Partial<Omit<PaymentRow, 'id'>>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  /** Fills this row with whatever the other rows leave to pay. */
  const fillRemaining = (id: number) => {
    const others = toPaymentLines(rows.filter((row) => row.id !== id)) ?? [];
    const paidElsewhere = others.reduce((sum, line) => sum + line.amount, 0);
    updateRow(id, { amount: moneyToInput(Math.max(0, total - paidElsewhere)) });
  };

  const addSplit = () => {
    const used = new Set(rows.map((row) => row.methodCode));
    const next = PAYMENT_METHODS.find((method) => !used.has(method.code)) ?? PAYMENT_METHODS[0];
    const paid = (lines ?? []).reduce((sum, line) => sum + line.amount, 0);
    setRows((current) => [
      ...current,
      {
        id: Math.max(...current.map((row) => row.id)) + 1,
        methodCode: next?.code ?? '',
        amount: moneyToInput(Math.max(0, total - paid)),
      },
    ]);
  };

  const blocker = !salesPersonId ? t.needSalesPerson : mobileInvalid ? t.checkMobile : null;
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
        if (!canConfirm || !settlement?.ok) return;
        writeJson('last-sales-person', salesPersonId);
        writeJson('last-payment-method', rows[0]?.methodCode ?? '');
        onConfirm({
          salesPersonId,
          customer: { mobile: mobile ?? '', name: name.trim() || knownName || '' },
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
          dir="ltr"
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

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium text-muted">{t.payment}</legend>
        {rows.map((row) => (
          <div key={row.id} className="flex flex-col gap-2 rounded-2xl bg-surface p-3">
            <div className="flex gap-2">
              <label htmlFor={`pay-method-${row.id}`} className="sr-only">
                {t.paymentMethod}
              </label>
              <select
                id={`pay-method-${row.id}`}
                value={row.methodCode}
                onChange={(event) => updateRow(row.id, { methodCode: event.target.value })}
                className="h-12 min-w-0 flex-1 rounded-xl border-2 border-line bg-bg px-3 text-base font-semibold"
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method.code} value={method.code}>
                    {method.label[lang]}
                  </option>
                ))}
              </select>
              {rows.length > 1 ? (
                <button
                  type="button"
                  aria-label={t.removePayment(methodLabel(row.methodCode))}
                  onClick={() => setRows((current) => current.filter((other) => other.id !== row.id))}
                  className="h-12 w-12 shrink-0 rounded-xl bg-surface-2 text-xl text-muted"
                >
                  ×
                </button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <label htmlFor={`pay-amount-${row.id}`} className="sr-only">
                {t.amountFor(methodLabel(row.methodCode))}
              </label>
              <input
                id={`pay-amount-${row.id}`}
                value={row.amount}
                onChange={(event) => updateRow(row.id, { amount: event.target.value })}
                onFocus={(event) => event.target.select()}
                inputMode="decimal"
                autoComplete="off"
                dir="ltr"
                className="tabular h-12 min-w-0 flex-1 rounded-xl border-2 border-line bg-bg px-3 font-mono text-lg focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => fillRemaining(row.id)}
                className="h-12 shrink-0 rounded-xl bg-surface-2 px-3 text-sm font-semibold"
              >
                {rows.length > 1 ? t.fillRest : t.fullAmount}
              </button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-sm">
          <span aria-live="polite">{paymentStatus}</span>
          {rows.length < PAYMENT_METHODS.length ? (
            <button type="button" onClick={addSplit} className="font-semibold text-accent">
              {t.splitPayment}
            </button>
          ) : null}
        </div>
      </fieldset>

      <Field
        id="customer-mobile"
        label={`${t.customerMobile} ${t.optional}`}
        hint={mobileInvalid ? t.mobileHint : knownName ? `${t.returningCustomer}: ${knownName}` : null}
      >
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

      <Field id="customer-name" label={`${t.customerName} ${t.optional}`}>
        <input
          id="customer-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="off"
          placeholder={knownName ?? ''}
          className="h-13 w-full rounded-2xl border-2 border-line bg-surface px-3 text-base focus:border-accent focus:outline-none"
        />
      </Field>

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
