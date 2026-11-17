import { normalizeEgyptianMobile, settlePayments, type PaymentLine, type PricedCart } from '@ravin-sales/domain';
import { useMemo, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { AnimatedMoney } from '../../components/Tiles.tsx';
import type { AppConfig } from '../../data/appData.ts';
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
  readonly config: AppConfig;
  readonly priced: PricedCart;
  readonly onBack: () => void;
  readonly onConfirm: (result: CheckoutResult) => void;
}

interface PaymentRow {
  readonly id: number;
  readonly methodCode: string;
  readonly amount: string;
}

/** The same method chosen twice is added up into one payment. Null if an amount is invalid. */
function toPaymentLines(rows: readonly PaymentRow[]): PaymentLine[] | null {
  const byMethod = new Map<string, number>();
  for (const row of rows) {
    const amount = parseAmount(row.amount);
    if (amount === null) return null;
    byMethod.set(row.methodCode, (byMethod.get(row.methodCode) ?? 0) + amount);
  }
  return [...byMethod].map(([methodCode, amount]) => ({ methodCode, amount }));
}

export function CheckoutView({ config, priced, onBack, onConfirm }: CheckoutViewProps) {
  const { t, lang } = useI18n();
  const methods = config.paymentMethods;
  const total = priced.totals.total;
  const [salesPersonId, setSalesPersonId] = useState(() => {
    const last = readJson<string>('last-sales-person', '');
    return config.employees.some((employee) => employee.id === last) ? last : '';
  });
  const [mobileInput, setMobileInput] = useState('');
  const [name, setName] = useState('');
  // Most sales are paid in full with one method: the row starts with the whole amount filled in.
  const [rows, setRows] = useState<readonly PaymentRow[]>(() => {
    const last = readJson<string>('last-payment-method', '');
    const method = methods.some((candidate) => candidate.code === last) ? last : (methods[0]?.code ?? '');
    return [{ id: 1, methodCode: method, amount: moneyToInput(total) }];
  });

  const branchStaff = config.employees.filter((employee) => employee.inBranch);
  const otherStaff = config.employees.filter((employee) => !employee.inBranch);
  const mobile = normalizeEgyptianMobile(mobileInput);
  const mobileInvalid = mobileInput.trim() !== '' && mobile === null;
  const lines = useMemo(() => toPaymentLines(rows), [rows]);
  const settlement = lines ? settlePayments(total, lines, methods) : null;
  const methodLabel = (code: string) => methods.find((method) => method.code === code)?.label[lang] ?? code;

  const updateRow = (id: number, patch: Partial<Omit<PaymentRow, 'id'>>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const fillRemaining = (id: number) => {
    const others = toPaymentLines(rows.filter((row) => row.id !== id)) ?? [];
    const paidElsewhere = others.reduce((sum, line) => sum + line.amount, 0);
    updateRow(id, { amount: moneyToInput(Math.max(0, total - paidElsewhere)) });
  };

  const addSplit = () => {
    const used = new Set(rows.map((row) => row.methodCode));
    const next = methods.find((method) => !used.has(method.code)) ?? methods[0];
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
      <span className="flex items-center gap-1 font-semibold text-free">
        <Icon name="check" className="h-4 w-4" />
        {t.paidExact}
      </span>
    )
  ) : settlement.reason === 'OVERPAID_WITHOUT_CASH' ? (
    <span className="text-danger">{t.overpaidNonCash(`${formatMoney(settlement.difference)} ${t.currency}`)}</span>
  ) : (
    <span className="text-muted">{t.stillToCollect(`${formatMoney(settlement.difference)} ${t.currency}`)}</span>
  );

  return (
    <form
      className="gutter mx-auto flex max-w-xl flex-col gap-4 pt-5 pb-10"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canConfirm || !settlement?.ok) return;
        writeJson('last-sales-person', salesPersonId);
        writeJson('last-payment-method', rows[0]?.methodCode ?? '');
        onConfirm({
          salesPersonId,
          customer: { mobile: mobile ?? '', name: name.trim() },
          payments: settlement.payments,
          change: settlement.change,
        });
      }}
    >
      <button
        type="button"
        onClick={onBack}
        className="press flex items-center gap-1 self-start text-sm font-semibold text-primary"
      >
        <Icon name="back" className="h-4 w-4 rtl:rotate-180" />
        {t.backToCart}
      </button>

      <div className="hero animate-pop rounded-3xl p-5 shadow-card">
        <div className="text-sm text-white/80">
          {t.total} · {t.pieces(priced.totals.unitCount)}
        </div>
        <div className="font-display text-4xl font-semibold">
          <AnimatedMoney amount={total} /> <span className="text-lg font-medium text-white/80">{t.currency}</span>
        </div>
      </div>

      <Card>
        <Field id="sales-person" label={t.salesPerson}>
          <select
            id="sales-person"
            dir="ltr"
            value={salesPersonId}
            onChange={(event) => setSalesPersonId(event.target.value)}
            className="h-13 w-full rounded-2xl border border-line bg-surface-2 px-3 text-base font-medium"
          >
            <option value="">{t.choose}</option>
            {branchStaff.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
            {otherStaff.length > 0 ? (
              <optgroup label={t.otherBranches}>
                {otherStaff.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </Field>
      </Card>

      <Card>
        <fieldset className="flex min-w-0 flex-col gap-2.5">
          <legend className="mb-2 text-sm font-medium text-muted">{t.payment}</legend>
          {rows.map((row) => (
            <div key={row.id} className="animate-rise flex flex-col gap-2 rounded-2xl bg-surface-2 p-2.5">
              <div className="flex gap-2">
                <label htmlFor={`pay-method-${row.id}`} className="sr-only">
                  {t.paymentMethod}
                </label>
                <select
                  id={`pay-method-${row.id}`}
                  value={row.methodCode}
                  onChange={(event) => updateRow(row.id, { methodCode: event.target.value })}
                  className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-base font-semibold"
                >
                  {methods.map((method) => (
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
                    className="press flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface text-muted"
                  >
                    <Icon name="close" />
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
                  className="tabular h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 font-mono text-lg focus:border-primary focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => fillRemaining(row.id)}
                  className="press h-12 shrink-0 rounded-xl bg-primary-soft px-3 text-sm font-semibold text-primary"
                >
                  {rows.length > 1 ? t.fillRest : t.fullAmount}
                </button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-sm">
            <span aria-live="polite">{paymentStatus}</span>
            {rows.length < methods.length ? (
              <button type="button" onClick={addSplit} className="press font-semibold text-primary">
                {t.splitPayment}
              </button>
            ) : null}
          </div>
        </fieldset>
      </Card>

      <Card>
        <Field
          id="customer-mobile"
          label={`${t.customerMobile} ${t.optional}`}
          hint={mobileInvalid ? t.mobileHint : null}
        >
          <input
            id="customer-mobile"
            value={mobileInput}
            onChange={(event) => setMobileInput(event.target.value)}
            inputMode="tel"
            autoComplete="off"
            dir="ltr"
            placeholder="01XXXXXXXXX"
            className="tabular h-13 w-full rounded-2xl border border-line bg-surface-2 px-3 font-mono text-lg tracking-wider focus:border-primary focus:outline-none"
          />
        </Field>
        <Field id="customer-name" label={`${t.customerName} ${t.optional}`}>
          <input
            id="customer-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
            className="h-13 w-full rounded-2xl border border-line bg-surface-2 px-3 text-base focus:border-primary focus:outline-none"
          />
        </Field>
      </Card>

      <div className="flex flex-col gap-2">
        {blocker ? <p className="text-center text-sm text-muted">{blocker}</p> : null}
        <button
          type="submit"
          disabled={!canConfirm}
          className="press flex min-h-15 items-center justify-center gap-2 rounded-2xl bg-primary px-6 text-lg font-semibold text-primary-fg shadow-card disabled:opacity-40"
        >
          <Icon name="check" />
          {t.confirmInvoice}
        </button>
      </div>
    </form>
  );
}

function Card({ children }: { readonly children: ReactNode }) {
  return <div className="animate-rise flex flex-col gap-4 rounded-3xl bg-surface p-4 shadow-card">{children}</div>;
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
      {hint ? <p className="text-sm text-danger">{hint}</p> : null}
    </div>
  );
}
