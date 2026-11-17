import { buildSalesReport, DomainError, voidBlocker, type Invoice, type SalesSummary } from '@ravin-sales/domain';
import { useMemo, useState } from 'react';
import { Code, Price } from '../../components/Price.tsx';
import { BRANCH, CATALOG_BY_CODE, EMPLOYEES, PAYMENT_METHODS } from '../../config/demo.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import type { Messages } from '../../i18n/messages.ts';
import { formatMoney, formatTime } from '../../lib/format.ts';

interface ReportViewProps {
  readonly invoices: readonly Invoice[];
  readonly businessDate: string;
  readonly onVoid: (number: string, reason: string) => void;
  readonly notify: (message: string) => void;
}

const employeeName = (id: string) => EMPLOYEES.find((employee) => employee.id === id)?.name ?? id;

export function ReportView({ invoices, businessDate, onVoid, notify }: ReportViewProps) {
  const { t, lang } = useI18n();
  const [scope, setScope] = useState('');
  const today = useMemo(
    () => invoices.filter((invoice) => invoice.businessDate === businessDate),
    [invoices, businessDate],
  );
  const visible = useMemo(
    () => (scope ? today.filter((invoice) => invoice.salesPersonId === scope) : today),
    [today, scope],
  );
  const report = useMemo(() => buildSalesReport(visible), [visible]);
  const summary = report.overall;
  const methodLabel = (code: string) => PAYMENT_METHODS.find((method) => method.code === code)?.label[lang] ?? code;

  const summaryText = buildSummaryText(t, summary, scope ? employeeName(scope) : t.everyone, businessDate, methodLabel);

  const copySummary = () => {
    navigator.clipboard
      .writeText(summaryText)
      .then(() => notify(t.copied))
      .catch(() => notify(t.copyFailed));
  };

  return (
    <div className="gutter mx-auto flex max-w-3xl flex-col gap-5 pt-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="report-scope" className="text-sm font-medium text-muted">
            {t.reportScope}
          </label>
          <select
            id="report-scope"
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            className="h-12 rounded-2xl border-2 border-line bg-surface px-3"
          >
            <option value="">{t.everyone}</option>
            {EMPLOYEES.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={copySummary}
          className="h-12 rounded-2xl bg-accent px-4 font-semibold text-accent-fg"
        >
          {t.copySummary}
        </button>
      </div>

      <section className="rounded-3xl bg-surface p-5">
        <div className="text-sm text-muted">{t.sales}</div>
        <div className="tabular text-4xl font-bold">
          {formatMoney(summary.total)} <span className="text-lg font-medium text-muted">{t.currency}</span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Stat label={t.invoicesLabel} value={String(summary.invoiceCount)} />
          <Stat label={t.piecesLabel} value={String(summary.unitCount)} />
          <Stat label={t.averageInvoice} value={formatMoney(summary.averageInvoice)} />
          <Stat label={t.piecesPerInvoice} value={summary.unitsPerInvoice.toFixed(2)} />
        </dl>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-3xl bg-surface p-5">
          <h2 className="mb-2 font-semibold">{t.byPaymentMethod}</h2>
          <ul className="flex flex-col gap-1.5">
            {PAYMENT_METHODS.map((method) => (
              <li key={method.code} className="flex justify-between">
                <span>{method.label[lang]}</span>
                <Price amount={summary.byPaymentMethod[method.code] ?? 0} className="font-semibold" />
              </li>
            ))}
            <li className="mt-1 flex justify-between border-t border-line pt-2 text-danger">
              <span>{t.voided}</span>
              <span className="tabular">
                {t.voidedSummary(summary.voided.count, `${formatMoney(summary.voided.total)} ${t.currency}`)}
              </span>
            </li>
          </ul>
        </section>

        {!scope ? (
          <section className="rounded-3xl bg-surface p-5">
            <h2 className="mb-2 font-semibold">{t.bySalesPerson}</h2>
            {Object.keys(report.bySalesPerson).length === 0 ? (
              <p className="text-sm text-muted">{t.noInvoices}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {Object.entries(report.bySalesPerson).map(([id, person]) => (
                  <li key={id} className="flex justify-between gap-2">
                    <span className="truncate">{employeeName(id)}</span>
                    <span className="flex items-baseline gap-2">
                      <span className="text-xs text-muted">{t.invoices(person.invoiceCount)}</span>
                      <Price amount={person.total} className="font-semibold" />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t.invoiceList}</h2>
        {visible.length === 0 ? (
          <p className="rounded-2xl bg-surface p-4 text-sm text-muted">{t.noInvoices}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((invoice) => (
              <InvoiceRow key={invoice.number} invoice={invoice} businessDate={businessDate} onVoid={onVoid} />
            ))}
          </ul>
        )}
      </section>

      <details className="text-sm text-muted">
        <summary className="cursor-pointer">{t.copySummary}</summary>
        <pre className="mt-2 overflow-x-auto rounded-2xl bg-surface p-3 font-mono text-xs whitespace-pre-wrap select-all">
          {summaryText}
        </pre>
      </details>
    </div>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tabular text-xl font-semibold">{value}</dd>
    </div>
  );
}

function buildSummaryText(
  t: Messages,
  summary: SalesSummary,
  scopeLabel: string,
  date: string,
  methodLabel: (code: string) => string,
): string {
  const money = (amount: number) => `${formatMoney(amount)} ${t.currency}`;
  return [
    t.summaryTitle(BRANCH.code, date),
    scopeLabel,
    `${t.sales}: ${money(summary.total)}`,
    `${t.invoicesLabel}: ${summary.invoiceCount} · ${t.piecesLabel}: ${summary.unitCount}`,
    `${t.averageInvoice}: ${money(summary.averageInvoice)}`,
    ...PAYMENT_METHODS.map(
      (method) => `${methodLabel(method.code)}: ${money(summary.byPaymentMethod[method.code] ?? 0)}`,
    ),
    `${t.voided}: ${t.voidedSummary(summary.voided.count, money(summary.voided.total))}`,
  ].join('\n');
}

function InvoiceRow({
  invoice,
  businessDate: date,
  onVoid: voidIt,
}: {
  readonly invoice: Invoice;
  readonly businessDate: string;
  readonly onVoid: (number: string, reason: string) => void;
}) {
  const { t, lang } = useI18n();
  const methodLabel = (code: string) => PAYMENT_METHODS.find((method) => method.code === code)?.label[lang] ?? code;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const voided = invoice.status === 'voided';
  const structuralBlocker = voidBlocker(invoice, date, 'reason');

  return (
    <li className={`rounded-2xl bg-surface ${voided ? 'opacity-70' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-3 text-start"
      >
        <div className="min-w-0 flex-1">
          <Code className={`font-semibold ${voided ? 'line-through' : ''}`}>{invoice.number}</Code>
          <div className="truncate text-xs text-muted">
            <bdi className="tabular">{formatTime(invoice.createdAt, lang)}</bdi> · {employeeName(invoice.salesPersonId)}{' '}
            · {t.pieces(invoice.totals.unitCount)}
          </div>
        </div>
        {voided ? (
          <span className="rounded-full bg-danger-bg px-2 py-0.5 text-xs font-semibold text-danger">
            {t.voidedBadge}
          </span>
        ) : null}
        <Price amount={invoice.totals.total} className="font-semibold" />
      </button>
      {open ? (
        <div className="flex flex-col gap-3 border-t border-line p-3">
          <div className="text-sm">
            {invoice.customer.name} ·{' '}
            <bdi dir="ltr" className="tabular">
              {invoice.customer.mobile}
            </bdi>
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            {invoice.lines.map((line) => (
              <li key={line.seq} className="flex justify-between gap-2">
                <span className="truncate">
                  <Code>{`${line.itemCode} · ${line.size}`}</Code> {CATALOG_BY_CODE.get(line.itemCode)?.name}
                </span>
                <Price amount={line.finalPrice} />
              </li>
            ))}
          </ul>
          <div className="text-sm text-muted">
            {invoice.payments
              .map((payment) => `${methodLabel(payment.methodCode)} ${formatMoney(payment.amount)}`)
              .join(' · ')}
          </div>
          {voided ? (
            <p className="text-sm text-danger">
              {t.voidReason}: {invoice.void?.reason}
            </p>
          ) : structuralBlocker ? (
            <p className="text-sm text-muted">{t.voidBlocked[structuralBlocker]}</p>
          ) : (
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                try {
                  voidIt(invoice.number, reason);
                  setError(null);
                } catch (caught) {
                  const blocker = caught instanceof DomainError ? voidBlocker(invoice, date, reason) : null;
                  setError(blocker ? t.voidBlocked[blocker] : String(caught));
                }
              }}
            >
              <label htmlFor={`void-${invoice.number}`} className="sr-only">
                {t.voidReason}
              </label>
              <input
                id={`void-${invoice.number}`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t.voidReasonPlaceholder}
                className="h-12 min-w-0 flex-1 rounded-xl border-2 border-line bg-bg px-3"
              />
              <button
                type="submit"
                disabled={reason.trim() === ''}
                className="h-12 rounded-xl bg-danger px-4 font-semibold text-surface disabled:opacity-40"
              >
                {t.confirmVoid}
              </button>
              {error ? <p className="text-sm text-danger">{error}</p> : null}
            </form>
          )}
        </div>
      ) : null}
    </li>
  );
}
