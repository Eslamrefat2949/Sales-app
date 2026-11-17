import { buildSalesReport, type SalesSummary } from '@ravin-sales/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { Code, Price } from '../../components/Price.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { AnimatedMoney, StatTile } from '../../components/Tiles.tsx';
import { useNotify } from '../../components/Toast.tsx';
import type { AppConfig } from '../../data/appData.ts';
import {
  batchDates,
  closeDay,
  fetchOpenInvoices,
  listExportBatches,
  mergeWithPending,
  odooSheet,
  openBatch,
  previewExport,
  voidInvoiceOnServer,
  type ClosedDay,
  type ExportBatch,
  type ExportPreview,
  type ReportInvoice,
} from '../../data/branchInvoices.ts';
import type { BranchSync } from '../../data/branchSync.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import type { Messages } from '../../i18n/messages.ts';
import { businessDateOf, formatMoney, formatTime } from '../../lib/format.ts';
import { downloadBlob } from '../../lib/files.ts';
import { errorCode } from '../../lib/supabase.ts';
import { ClosingSheet } from './ClosingSheet.tsx';

export function ReportView({ config, sync }: { readonly config: AppConfig; readonly sync: BranchSync }) {
  const { t, lang } = useI18n();
  const notify = useNotify();
  const today = businessDateOf(new Date());
  const [server, setServer] = useState<ReportInvoice[] | null>(null);
  const [batches, setBatches] = useState<ExportBatch[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [scope, setScope] = useState('');
  const [closing, setClosing] = useState<ExportPreview | null>(null);
  const [register, setRegister] = useState<{
    readonly closed: ClosedDay;
    readonly fresh: boolean;
    readonly sheetDownloaded: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const closeRegister = useCallback(() => setRegister(null), []);

  const refresh = useCallback(async () => {
    try {
      // The report counts from the last close, so the history comes first.
      const history = await listExportBatches();
      const invoices = await fetchOpenInvoices(config, history[0]?.createdAt ?? null);
      setServer(invoices);
      setBatches(history);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [config]);

  useEffect(() => {
    void refresh();
  }, [refresh, sync.pending.length]);

  const all = useMemo(
    () => mergeWithPending(server ?? [], sync.pending, config.branch?.code ?? ''),
    [server, sync.pending, config.branch],
  );
  const visible = useMemo(() => (scope ? all.filter((invoice) => invoice.salesPersonId === scope) : all), [all, scope]);
  const report = useMemo(() => buildSalesReport(visible), [visible]);
  const summary = report.overall;
  const employeeName = (id: string) => config.employees.find((employee) => employee.id === id)?.name ?? '—';
  const methodLabel = (code: string) =>
    config.paymentMethods.find((method) => method.code === code)?.label[lang] ?? code;
  const people = useMemo(() => [...new Set(all.map((invoice) => invoice.salesPersonId))], [all]);
  const summaryText = buildSummaryText(
    t,
    summary,
    config.branch?.code ?? '',
    scope ? employeeName(scope) : t.everyone,
    today,
    config,
    lang,
  );

  const startClose = async () => {
    try {
      setClosing(await previewExport());
    } catch (error) {
      notify(errorCode(error) === 'OFFLINE' ? t.pinOffline : t.genericError, 'error');
    }
  };

  /** Closes the day, downloads the Odoo sheet and opens the closing register with the photo to save. */
  const close = async () => {
    setBusy(true);
    try {
      const closed = await closeDay(config);
      setClosing(null);
      if (!closed) {
        notify(t.exportNothing, 'info');
        return;
      }
      let sheetDownloaded = false;
      try {
        const sheet = await odooSheet(config, closed);
        downloadBlob(sheet.blob, sheet.fileName);
        sheetDownloaded = true;
      } catch {
        // The register below has a download button for the sheet.
      }
      setRegister({ closed, fresh: true, sheetDownloaded });
      notify(t.exportDone(closed.batch.invoiceCount), 'success');
      void refresh();
    } catch (error) {
      notify(errorCode(error) === 'OFFLINE' ? t.pinOffline : t.genericError, 'error');
    } finally {
      setBusy(false);
    }
  };

  const openRegister = async (batch: ExportBatch) => {
    setBusy(true);
    try {
      setRegister({ closed: await openBatch(config, batch.id), fresh: false, sheetDownloaded: false });
    } catch (error) {
      notify(errorCode(error) === 'OFFLINE' ? t.pinOffline : t.genericError, 'error');
    } finally {
      setBusy(false);
    }
  };

  const copySummary = () => {
    navigator.clipboard
      .writeText(summaryText)
      .then(() => notify(t.copied, 'success'))
      .catch(() => notify(t.copyFailed, 'error'));
  };

  return (
    <div className="gutter mx-auto flex max-w-3xl flex-col gap-5 pt-5 pb-10">
      {loadFailed ? <p className="rounded-2xl bg-promo-bg p-3 text-sm text-promo">{t.reportOffline}</p> : null}

      <section className="hero animate-rise rounded-3xl p-5 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm text-white/80">
              {t.sales} · {t.openPeriod}
            </div>
            <div className="font-display text-4xl font-semibold">
              <AnimatedMoney amount={summary.total} />{' '}
              <span className="text-lg font-medium text-white/80">{t.currency}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            aria-label={t.refresh}
            className="press rounded-full bg-white/18 p-2"
          >
            <Icon name="cloud" />
          </button>
        </div>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {['', ...people].map((id) => (
            <button
              key={id || 'all'}
              type="button"
              onClick={() => setScope(id)}
              dir={id ? 'ltr' : undefined}
              className={`press shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold ${
                scope === id ? 'bg-white text-primary' : 'bg-white/15 text-white'
              }`}
            >
              {id ? employeeName(id).replace(/^\d+-/, '') : t.everyone}
            </button>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <StatTile tone="blue" icon="receipt" label={t.invoicesLabel}>
          {summary.invoiceCount}
        </StatTile>
        <StatTile tone="green" icon="tag" label={t.piecesLabel}>
          {summary.unitCount}
        </StatTile>
        <StatTile tone="amber" icon="chart" label={t.averageInvoice}>
          <Price amount={summary.averageInvoice} />
        </StatTile>
        <StatTile tone="purple" icon="close" label={t.voided}>
          {t.voidedSummary(summary.voided.count, `${formatMoney(summary.voided.total)} ${t.currency}`)}
        </StatTile>
      </div>

      <section className="animate-rise rounded-3xl bg-surface p-5 shadow-card">
        <h2 className="mb-3 font-display text-lg font-semibold">{t.byPaymentMethod}</h2>
        {Object.keys(summary.byPaymentMethod).length === 0 ? (
          <p className="text-sm text-muted">{t.noInvoices}</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {Object.entries(summary.byPaymentMethod)
              .sort((a, b) => b[1] - a[1])
              .map(([code, amount]) => (
                <li key={code} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />
                    {methodLabel(code)}
                  </span>
                  <Price amount={amount} className="font-semibold" />
                </li>
              ))}
          </ul>
        )}
        <button
          type="button"
          onClick={copySummary}
          className="press mt-4 flex items-center gap-2 text-sm font-semibold text-primary"
        >
          <Icon name="receipt" className="h-4 w-4" />
          {t.copySummary}
        </button>
      </section>

      <section className="animate-rise flex flex-col gap-3 rounded-3xl bg-surface p-5 shadow-card">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-tile-blue text-tile-blue-fg">
            <Icon name="download" />
          </span>
          <div>
            <h2 className="font-display text-lg font-semibold">{t.exportTitle}</h2>
            <p className="text-sm text-muted">{t.closeHint}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void startClose()}
          className="press flex h-14 items-center justify-center gap-2 rounded-2xl bg-primary font-semibold text-primary-fg shadow-card"
        >
          <Icon name="download" />
          {t.exportTitle}
        </button>
        {batches.length > 0 ? (
          <div className="mt-2 flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-muted">{t.previousExports}</h3>
            <ul className="flex flex-col gap-2">
              {batches.map((batch) => (
                <li key={batch.id} className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">
                      {t.salesDate}{' '}
                      <bdi dir="ltr" className="tabular">
                        {batchDates(batch)}
                      </bdi>{' '}
                      · {t.invoices(batch.invoiceCount)}
                    </div>
                    <div className="text-xs text-muted">
                      <Price amount={batch.total} /> ·{' '}
                      <bdi className="tabular">{formatTime(batch.createdAt, lang)}</bdi> ·{' '}
                      {t.downloadedTimes(batch.downloadCount)}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void openRegister(batch)}
                    className="press flex shrink-0 items-center gap-1.5 rounded-xl bg-surface px-3 py-2 text-sm font-semibold text-primary shadow-sm disabled:opacity-50"
                  >
                    <Icon name="receipt" className="h-4 w-4" />
                    {t.openClosing}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold">{t.invoiceList}</h2>
        {visible.length === 0 ? (
          <p className="rounded-2xl bg-surface p-4 text-sm text-muted shadow-card">{t.noInvoices}</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {visible.map((invoice) => (
              <InvoiceRow
                key={invoice.number}
                invoice={invoice}
                employeeName={(invoice.salesPersonName ?? employeeName(invoice.salesPersonId)).replace(/^\d+-/, '')}
                methodLabel={methodLabel}
                onVoided={() => void refresh()}
              />
            ))}
          </ul>
        )}
      </section>

      {closing ? (
        <Sheet title={t.exportTitle} closeLabel={t.cancel} onClose={() => setClosing(null)}>
          <div className="flex flex-col gap-4 pb-2">
            <div className="grid grid-cols-2 gap-3">
              <StatTile tone="blue" icon="receipt" label={t.invoicesLabel}>
                {closing.invoices}
              </StatTile>
              <StatTile tone="green" icon="chart" label={t.sales}>
                <Price amount={closing.total} />
              </StatTile>
            </div>
            {closing.pendingOnPhones > 0 ? (
              <p className="rounded-2xl bg-promo-bg p-3 text-sm text-promo">
                {t.exportPendingWarning(closing.pendingOnPhones)}
              </p>
            ) : null}
            {closing.invoices === 0 ? (
              <p className="text-muted">{t.exportNothing}</p>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void close()}
                className="press flex h-14 items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-semibold text-primary-fg disabled:opacity-50"
              >
                <Icon name="download" />
                {t.exportButton(closing.invoices)}
              </button>
            )}
          </div>
        </Sheet>
      ) : null}

      {register ? (
        <ClosingSheet
          config={config}
          closed={register.closed}
          fresh={register.fresh}
          sheetDownloaded={register.sheetDownloaded}
          onClose={closeRegister}
          onRecorded={() => void refresh()}
        />
      ) : null}
    </div>
  );
}

function InvoiceRow({
  invoice,
  employeeName,
  methodLabel,
  onVoided,
}: {
  readonly invoice: ReportInvoice;
  readonly employeeName: string;
  readonly methodLabel: (code: string) => string;
  readonly onVoided: () => void;
}) {
  const { t, lang } = useI18n();
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const voided = invoice.status === 'voided';

  const badge = voided
    ? { text: t.voidedBadge, className: 'bg-danger-bg text-danger' }
    : !invoice.synced
      ? invoice.syncError
        ? { text: t.syncErrorBadge, className: 'bg-danger-bg text-danger' }
        : { text: t.waitingBadge, className: 'bg-promo-bg text-promo' }
      : null;

  const submitVoid = async () => {
    if (!invoice.synced) return notify(t.voidErrors.WAITING ?? t.genericError, 'error');
    setBusy(true);
    try {
      await voidInvoiceOnServer(invoice.number, reason);
      notify(t.voidedToast(invoice.number), 'success');
      onVoided();
    } catch (error) {
      const code = errorCode(error);
      notify(t.voidErrors[code] ?? t.voidErrors.UNKNOWN ?? t.genericError, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`animate-rise rounded-2xl bg-surface shadow-card ${voided ? 'opacity-70' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-3.5 text-start"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tile-blue text-tile-blue-fg">
          <Icon name="receipt" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <Code className={`font-semibold ${voided ? 'line-through' : ''}`}>{invoice.number}</Code>
          <div className="truncate text-xs text-muted">
            <bdi className="tabular">{formatTime(invoice.createdAt, lang)}</bdi> · <bdi dir="ltr">{employeeName}</bdi> ·{' '}
            {t.pieces(invoice.totals.unitCount)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Price amount={invoice.totals.total} className="font-display font-semibold" />
          {badge ? (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}>
              {badge.text}
            </span>
          ) : null}
        </div>
      </button>
      {open ? (
        <div className="flex flex-col gap-3 border-t border-line p-3.5">
          {invoice.customer.mobile || invoice.customer.name ? (
            <div className="text-sm">
              {invoice.customer.name}{' '}
              {invoice.customer.mobile ? (
                <bdi dir="ltr" className="tabular text-muted">
                  {invoice.customer.mobile}
                </bdi>
              ) : null}
            </div>
          ) : null}
          <ul className="flex flex-col gap-1 text-sm">
            {invoice.lines.map((line) => (
              <li key={line.seq} className="flex justify-between gap-2">
                <Code>{line.barcode}</Code>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted">{line.discountPercent}%</span>
                  <Price amount={line.finalPrice} />
                </span>
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
          ) : (
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                void submitVoid();
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
                className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3"
              />
              <button
                type="submit"
                disabled={reason.trim() === '' || busy}
                className="press h-12 rounded-xl bg-danger px-4 font-semibold text-white disabled:opacity-40"
              >
                {t.confirmVoid}
              </button>
            </form>
          )}
        </div>
      ) : null}
    </li>
  );
}

function buildSummaryText(
  t: Messages,
  summary: SalesSummary,
  branch: string,
  scopeLabel: string,
  date: string,
  config: AppConfig,
  lang: 'ar' | 'en',
): string {
  const money = (amount: number) => `${formatMoney(amount)} ${t.currency}`;
  const label = (code: string) => config.paymentMethods.find((method) => method.code === code)?.label[lang] ?? code;
  return [
    t.summaryTitle(branch, date),
    scopeLabel,
    `${t.sales}: ${money(summary.total)}`,
    `${t.invoicesLabel}: ${summary.invoiceCount} · ${t.piecesLabel}: ${summary.unitCount}`,
    `${t.averageInvoice}: ${money(summary.averageInvoice)}`,
    ...Object.entries(summary.byPaymentMethod).map(([code, amount]) => `${label(code)}: ${money(amount)}`),
    `${t.voided}: ${t.voidedSummary(summary.voided.count, money(summary.voided.total))}`,
  ].join('\n');
}
