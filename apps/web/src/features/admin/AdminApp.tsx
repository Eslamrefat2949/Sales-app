import {
  findItemListColumns,
  findStaffColumns,
  normalizeDigits,
  prepareCatalogImport,
  prepareStaffImport,
  readItemCodes,
  readItemListRows,
  readStaffRows,
  type CatalogImport,
  type StaffImport,
} from '@ravin-sales/domain';
import { readSheet } from 'read-excel-file/browser';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { Price } from '../../components/Price.tsx';
import { AnimatedMoney, StatTile } from '../../components/Tiles.tsx';
import { useNotify } from '../../components/Toast.tsx';
import {
  fetchBranchesToday,
  listAccounts,
  listBranchCodes,
  listBranches,
  listBranchStaff,
  listStaffNames,
  listStaffRows,
  resetAccountPin,
  loadSettings,
  saveDefaultDiscount,
  saveOffer,
  setAccountPin,
  setItemsDiscountable,
  setStaffLink,
  uploadProducts,
  uploadStaff,
  type AccountRow,
  type BranchOption,
  type BranchToday,
  type OfferRow,
} from '../../data/admin.ts';
import type { LoadedData } from '../../data/appData.ts';
import { downloadTemplate, type TemplateKind } from '../../data/templates.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { businessDateOf, formatTime } from '../../lib/format.ts';
import { errorCode } from '../../lib/supabase.ts';
import { BranchHeader } from '../branch/BranchApp.tsx';

type Tab = 'dashboard' | 'items' | 'staff' | 'settings' | 'pins';
const TABS: readonly { readonly tab: Tab; readonly icon: IconName }[] = [
  { tab: 'dashboard', icon: 'chart' },
  { tab: 'items', icon: 'tag' },
  { tab: 'staff', icon: 'users' },
  { tab: 'settings', icon: 'settings' },
  { tab: 'pins', icon: 'key' },
];

export function AdminApp({ data }: { readonly data: LoadedData }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('dashboard');
  const label: Record<Tab, string> = {
    dashboard: t.tabDashboard,
    items: t.tabItems,
    staff: t.tabStaff,
    settings: t.tabSettings,
    pins: t.tabPins,
  };

  return (
    <div className="flex min-h-full flex-col">
      <BranchHeader
        account={data.config.account}
        title={t.adminTitle}
        subtitle={data.config.account.label}
        offline={data.offline}
      >
        <nav className="flex gap-2 overflow-x-auto pb-1">
          {TABS.map(({ tab: option, icon }) => (
            <button
              key={option}
              type="button"
              onClick={() => setTab(option)}
              aria-current={tab === option ? 'page' : undefined}
              className={`press flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${
                tab === option ? 'bg-white text-primary shadow-card' : 'bg-white/15 text-white'
              }`}
            >
              <Icon name={icon} className="h-4 w-4" />
              {label[option]}
            </button>
          ))}
        </nav>
      </BranchHeader>
      <main className="gutter mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 pt-5 pb-10">
        {tab === 'dashboard' ? (
          <Dashboard />
        ) : tab === 'items' ? (
          <Items />
        ) : tab === 'staff' ? (
          <Staff />
        ) : tab === 'settings' ? (
          <Settings />
        ) : (
          <Pins />
        )}
      </main>
    </div>
  );
}

function Card({
  title,
  icon,
  template,
  children,
}: {
  readonly title: string;
  readonly icon: IconName;
  /** Shows a button that downloads the upload template of this card. */
  readonly template?: TemplateKind;
  readonly children: ReactNode;
}) {
  return (
    <section className="animate-rise flex flex-col gap-4 rounded-3xl bg-surface p-5 shadow-card">
      <div className="flex items-center gap-3">
        <h2 className="flex min-w-0 flex-1 items-center gap-3 font-display text-lg font-semibold">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-tile-blue text-tile-blue-fg">
            <Icon name={icon} />
          </span>
          {title}
        </h2>
        {template ? <TemplateButton kind={template} /> : null}
      </div>
      {children}
    </section>
  );
}

function TemplateButton({ kind }: { readonly kind: TemplateKind }) {
  const { t } = useI18n();
  const notify = useNotify();
  return (
    <button
      type="button"
      onClick={() => void downloadTemplate(kind).catch(() => notify(t.genericError, 'error'))}
      className="press flex shrink-0 items-center gap-1.5 rounded-xl bg-primary-soft px-3 py-2 text-sm font-semibold text-primary"
    >
      <Icon name="file" className="h-4 w-4" />
      {t.downloadTemplate}
    </button>
  );
}

/** The dashed "choose a file" button used by every upload. */
function FilePicker({ label, onFile }: { readonly label: string; readonly onFile: (file: File) => void }) {
  return (
    <label className="press flex h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/40 bg-primary-soft font-semibold text-primary">
      <Icon name="upload" />
      {label}
      <input
        type="file"
        accept=".xlsx"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />
    </label>
  );
}

function Dashboard() {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<BranchToday[] | null>(null);
  const load = useCallback(() => {
    fetchBranchesToday()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const total = (rows ?? []).reduce((sum, row) => sum + row.total, 0);
  const invoices = (rows ?? []).reduce((sum, row) => sum + row.invoices, 0);
  const pieces = (rows ?? []).reduce((sum, row) => sum + row.pieces, 0);
  const waiting = (rows ?? []).reduce((sum, row) => sum + row.phonesPending, 0);
  const active = (rows ?? []).filter((row) => row.invoices > 0 || row.voided > 0);

  return (
    <>
      <section className="hero animate-rise rounded-3xl p-5 shadow-card">
        <div className="text-sm text-white/80">
          {t.sales} · {t.allBranches}
        </div>
        <div className="font-display text-4xl font-semibold">
          <AnimatedMoney amount={total} /> <span className="text-lg text-white/80">{t.currency}</span>
        </div>
      </section>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile tone="blue" icon="receipt" label={t.invoicesLabel}>
          {invoices}
        </StatTile>
        <StatTile tone="green" icon="tag" label={t.piecesLabel}>
          {pieces}
        </StatTile>
        <StatTile tone="amber" icon="chart" label={t.averageInvoice}>
          <Price amount={invoices ? Math.round(total / invoices) : 0} />
        </StatTile>
        <StatTile tone="purple" icon="cloud" label={t.phonesWaiting}>
          {waiting}
        </StatTile>
      </div>
      <Card title={t.allBranches} icon="chart">
        {rows === null ? (
          <p className="text-muted">{t.loadingSettings}</p>
        ) : active.length === 0 ? (
          <p className="text-muted">{t.noSalesYet}</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {active.map((row) => (
              <li key={row.branchId} className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
                <span className="flex h-11 w-14 items-center justify-center rounded-xl bg-primary font-mono text-sm font-semibold text-primary-fg">
                  {row.code}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold" dir="ltr">
                    {row.posName}
                  </div>
                  <div className="text-xs text-muted">
                    {t.invoices(row.invoices)} · {t.pieces(row.pieces)}
                    {row.notExported > 0 ? ` · ${t.notExported}: ${row.notExported}` : ''}
                    {row.phonesPending > 0 ? ` · ${t.phonesWaiting}: ${row.phonesPending}` : ''}
                    {row.lastSync ? ` · ${t.lastSync} ${formatTime(row.lastSync, lang)}` : ''}
                  </div>
                </div>
                <Price amount={row.total} className="font-display font-semibold" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Items() {
  const { t } = useI18n();
  const notify = useNotify();
  const [prepared, setPrepared] = useState<CatalogImport | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState('');
  const n = (value: number) => value.toLocaleString('en-US');

  const read = async (file: File) => {
    setPrepared(null);
    setStatus(t.reading);
    try {
      const rows = await readSheet(file);
      const columns = findItemListColumns(rows[0] ?? []);
      if ('missing' in columns) {
        setStatus(t.missingColumns(columns.missing.join(', ')));
        return;
      }
      setPrepared(prepareCatalogImport(readItemListRows(rows, columns)));
      setStatus(null);
    } catch {
      setStatus(t.genericError);
    }
  };

  const upload = async () => {
    if (!prepared) return;
    setBusy(true);
    try {
      const all = prepared.products.length;
      const result = await uploadProducts(prepared.products, (done) => setStatus(t.uploading(n(done), n(all))));
      setStatus(t.uploadDone(n(result.inserted), n(result.updated), n(result.unchanged)));
      notify(t.saved, 'success');
      setPrepared(null);
    } catch {
      setStatus(t.genericError);
    } finally {
      setBusy(false);
    }
  };

  const readCodes = async (file: File) => {
    try {
      const list = readItemCodes(await readSheet(file));
      setCodes(list.join('\n'));
      notify(t.codesRead(list.length), 'info');
    } catch {
      notify(t.genericError, 'error');
    }
  };

  const applyDiscountFlag = async (discountable: boolean) => {
    const list = [
      ...new Set(
        normalizeDigits(codes)
          .split(/[\s,;]+/)
          .map((code) => code.trim())
          .filter(Boolean),
      ),
    ];
    if (list.length === 0) return;
    setBusy(true);
    try {
      notify(t.codesUpdated(await setItemsDiscountable(list, discountable)), 'success');
    } catch {
      notify(t.genericError, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card title={t.itemsTitle} icon="upload" template="items">
        <p className="text-sm text-muted">{t.itemsHint}</p>
        <FilePicker label={t.chooseFile} onFile={(file) => void read(file)} />
        {prepared ? (
          <div className="grid grid-cols-2 gap-3">
            <StatTile tone="green" icon="check" label={t.previewSellable(n(prepared.products.length))}>
              {n(prepared.products.length)}
            </StatTile>
            <StatTile tone="amber" icon="tag" label={t.previewNoPrice(n(prepared.skipped.noPrice.length))}>
              {n(prepared.skipped.noPrice.length)}
            </StatTile>
            <StatTile
              tone="purple"
              icon="close"
              label={t.previewDuplicates(n(prepared.skipped.duplicateBarcode.length))}
            >
              {n(prepared.skipped.duplicateBarcode.length)}
            </StatTile>
            <StatTile tone="blue" icon="receipt" label={t.previewInvalid(n(prepared.skipped.invalid.length))}>
              {n(prepared.skipped.invalid.length)}
            </StatTile>
          </div>
        ) : null}
        {status ? (
          <p className="rounded-2xl bg-surface-2 p-3 text-sm" role="status">
            {status}
          </p>
        ) : null}
        {prepared ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void upload()}
            className="press h-14 rounded-2xl bg-primary font-semibold text-primary-fg disabled:opacity-50"
          >
            {t.upload}
          </button>
        ) : null}
      </Card>

      <Card title={t.noDiscountTitle} icon="tag" template="noDiscount">
        <p className="text-sm text-muted">{t.noDiscountHint}</p>
        <FilePicker label={t.uploadSheetCodes} onFile={(file) => void readCodes(file)} />
        <textarea
          value={codes}
          onChange={(event) => setCodes(event.target.value)}
          rows={4}
          dir="ltr"
          placeholder={'R219822\nO178475'}
          className="rounded-2xl border border-line bg-surface-2 p-3 font-mono"
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void applyDiscountFlag(false)}
            className="press h-12 rounded-2xl bg-primary font-semibold text-primary-fg disabled:opacity-50"
          >
            {t.noDiscountApply}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void applyDiscountFlag(true)}
            className="press h-12 rounded-2xl bg-surface-2 font-semibold disabled:opacity-50"
          >
            {t.noDiscountRestore}
          </button>
        </div>
      </Card>
    </>
  );
}

/** Day-to-day staff changes: pick a branch, add one person by name, or take someone off it. */
function StaffByBranch() {
  const { t } = useI18n();
  const notify = useNotify();
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchId, setBranchId] = useState('');
  const [staff, setStaff] = useState<{ id: string; name: string }[] | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const branch = branches.find((option) => option.id === branchId) ?? null;

  useEffect(() => {
    listBranches()
      .then(setBranches)
      .catch(() => notify(t.genericError, 'error'));
    listStaffNames()
      .then(setNames)
      .catch(() => undefined);
  }, [notify, t]);

  const loadStaff = useCallback(
    (id: string) => {
      setStaff(null);
      listBranchStaff(id)
        .then(setStaff)
        .catch(() => notify(t.genericError, 'error'));
    },
    [notify, t],
  );
  useEffect(() => {
    if (branchId) loadStaff(branchId);
  }, [branchId, loadStaff]);

  const change = async (person: string, active: boolean) => {
    if (!branch || person.trim() === '') return;
    setBusy(true);
    try {
      await setStaffLink(person, branch.id, active);
      notify(
        active ? t.staffAdded(person.trim().toUpperCase(), branch.code) : t.staffRemoved(person, branch.code),
        'success',
      );
      if (active) setName('');
      setRemoving(null);
      loadStaff(branch.id);
      if (active) void listStaffNames().then(setNames);
    } catch {
      notify(t.genericError, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t.staffByBranchTitle} icon="users">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="staff-branch" className="text-sm font-medium text-muted">
          {t.branch}
        </label>
        <select
          id="staff-branch"
          dir="ltr"
          value={branchId}
          onChange={(event) => setBranchId(event.target.value)}
          className="h-13 rounded-2xl border border-line bg-surface-2 px-3 text-base font-semibold"
        >
          <option value="">{t.choose}</option>
          {branches.map((option) => (
            <option key={option.id} value={option.id}>
              {option.code} · {option.posName}
            </option>
          ))}
        </select>
      </div>

      {branch ? (
        <>
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void change(name, true);
            }}
          >
            <label htmlFor="staff-name" className="text-sm font-medium text-muted">
              {t.addStaffLabel(branch.code)}
            </label>
            <div className="flex gap-2">
              <input
                id="staff-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                list="staff-names"
                dir="ltr"
                autoComplete="off"
                placeholder="1234-AHMED MOHAMED ALI"
                className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 font-medium uppercase"
              />
              <button
                type="submit"
                disabled={busy || name.trim() === ''}
                className="press flex h-12 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 font-semibold text-primary-fg disabled:opacity-50"
              >
                <Icon name="plus" className="h-4 w-4" />
                {t.addStaff}
              </button>
            </div>
            <datalist id="staff-names">
              {names.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
            <p className="text-xs text-muted">{t.staffNameHint}</p>
          </form>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-muted">{t.branchStaffCount(staff?.length ?? 0)}</h3>
            {staff === null ? (
              <p className="text-sm text-muted">{t.reading}</p>
            ) : staff.length === 0 ? (
              <p className="text-sm text-muted">{t.noBranchStaff}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {staff.map((person) => (
                  <li key={person.id} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="ltr">
                      {person.name}
                    </span>
                    {removing === person.id ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void change(person.name, false)}
                        className="press shrink-0 rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {t.confirmRemove}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRemoving(person.id)}
                        className="press shrink-0 rounded-lg bg-surface px-3 py-1.5 text-sm font-semibold text-danger"
                      >
                        {t.removeStaff}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </Card>
  );
}

function Staff() {
  const { t } = useI18n();
  const notify = useNotify();
  const [prepared, setPrepared] = useState<StaffImport | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const read = async (file: File) => {
    setPrepared(null);
    setStatus(t.reading);
    try {
      const [rows, codes] = await Promise.all([readSheet(file), listBranchCodes()]);
      const columns = findStaffColumns(rows[0] ?? []);
      if ('missing' in columns) {
        setStatus(t.missingColumns(columns.missing.join(', ')));
        return;
      }
      const result = prepareStaffImport(readStaffRows(rows, columns), codes);
      setPrepared(result);
      setStatus(
        result.unknownBranches.length > 0
          ? t.unknownBranches(result.unknownBranches.join(', '))
          : result.invalid.length > 0
            ? t.invalidRows(result.invalid.slice(0, 8).join(', '))
            : null,
      );
    } catch {
      setStatus(t.genericError);
    }
  };

  const upload = async () => {
    if (!prepared) return;
    setBusy(true);
    try {
      const result = await uploadStaff(prepared.rows);
      setStatus(t.staffDone(result.added, result.left, result.activeEmployees));
      notify(t.saved, 'success');
      setPrepared(null);
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
      setStatus(
        errorCode(error) === 'UNKNOWN_BRANCH'
          ? t.unknownBranches(message.replace(/^UNKNOWN_BRANCH\s*/, ''))
          : t.genericError,
      );
    } finally {
      setBusy(false);
    }
  };

  const downloadCurrent = async () => {
    setBusy(true);
    try {
      const rows = await listStaffRows();
      await downloadTemplate(
        'staff',
        rows.map((row) => [row.name, row.branch, 'Active']),
        `RAVIN Sales - Staff ${businessDateOf(new Date())}.xlsx`,
      );
    } catch {
      notify(t.genericError, 'error');
    } finally {
      setBusy(false);
    }
  };

  const blocked = !prepared || prepared.rows.length === 0 || prepared.unknownBranches.length > 0;

  return (
    <>
      <StaffByBranch />
      <Card title={t.staffTitle} icon="upload" template="staff">
        <p className="text-sm text-muted">{t.staffHint}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void downloadCurrent()}
          className="press flex h-12 items-center justify-center gap-2 rounded-2xl bg-surface-2 font-semibold disabled:opacity-50"
        >
          <Icon name="download" className="h-4 w-4" />
          {t.downloadCurrentStaff}
        </button>
        <FilePicker label={t.chooseFile} onFile={(file) => void read(file)} />
        {prepared ? (
          <div className="grid grid-cols-2 gap-3">
            <StatTile tone="blue" icon="users" label={t.staffPeople}>
              {prepared.people}
            </StatTile>
            <StatTile tone="green" icon="check" label={t.staffRowsLabel}>
              {prepared.rows.length}
            </StatTile>
            <StatTile tone="amber" icon="logout" label={t.staffLeaving}>
              {prepared.leaving.length}
            </StatTile>
            <StatTile tone="purple" icon="close" label={t.staffInvalid}>
              {prepared.invalid.length + prepared.unknownBranches.length}
            </StatTile>
          </div>
        ) : null}
        {status ? (
          <p className="rounded-2xl bg-surface-2 p-3 text-sm" role="status">
            {status}
          </p>
        ) : null}
        {prepared ? (
          <button
            type="button"
            disabled={busy || blocked}
            onClick={() => void upload()}
            className="press h-14 rounded-2xl bg-primary font-semibold text-primary-fg disabled:opacity-50"
          >
            {t.upload}
          </button>
        ) : null}
      </Card>
    </>
  );
}

function Settings() {
  const { t } = useI18n();
  const notify = useNotify();
  const [discount, setDiscount] = useState('');
  const [offers, setOffers] = useState<OfferRow[]>([]);

  useEffect(() => {
    loadSettings()
      .then((settings) => {
        setDiscount(String(settings.defaultDiscountPercent));
        setOffers(settings.offers);
      })
      .catch(() => notify(t.genericError, 'error'));
  }, [notify, t]);

  const save = async () => {
    const percent = Number(normalizeDigits(discount));
    const offersValid = offers.every((offer) => offer.payQty >= 1 && offer.buyQty > offer.payQty);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100 || !offersValid) {
      notify(t.genericError, 'error');
      return;
    }
    try {
      await saveDefaultDiscount(percent);
      await Promise.all(offers.map(saveOffer));
      notify(t.settingsSaved, 'success');
    } catch {
      notify(t.genericError, 'error');
    }
  };

  return (
    <Card title={t.tabSettings} icon="settings">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-muted">{t.defaultDiscount}</span>
        <input
          value={discount}
          onChange={(event) => setDiscount(event.target.value)}
          inputMode="decimal"
          dir="ltr"
          className="h-13 rounded-2xl border border-line bg-surface-2 px-4 font-display text-2xl font-semibold"
        />
      </label>
      {offers.map((offer) => (
        <div key={offer.id} className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-4">
          <div className="flex items-center justify-between">
            <span className="font-semibold">
              {t.offerSettings}: {t.offerName(offer.buyQty, offer.payQty)}
            </span>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={offer.isActive}
                onChange={(event) =>
                  setOffers((list) =>
                    list.map((item) => (item.id === offer.id ? { ...item, isActive: event.target.checked } : item)),
                  )
                }
                className="h-5 w-5 accent-[var(--primary)]"
              />
              {t.offerActive}
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(['buyQty', 'payQty'] as const).map((field) => (
              <label key={field} className="flex flex-col gap-1">
                <span className="text-xs text-muted">{field === 'buyQty' ? t.buyQty : t.payQty}</span>
                <input
                  value={offer[field]}
                  inputMode="numeric"
                  dir="ltr"
                  onChange={(event) =>
                    setOffers((list) =>
                      list.map((item) =>
                        item.id === offer.id
                          ? { ...item, [field]: Number(normalizeDigits(event.target.value)) || 0 }
                          : item,
                      ),
                    )
                  }
                  className="h-12 rounded-xl border border-line bg-surface px-3 font-display text-xl font-semibold"
                />
              </label>
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => void save()}
        className="press h-14 rounded-2xl bg-primary font-semibold text-primary-fg"
      >
        {t.save}
      </button>
    </Card>
  );
}

function Pins() {
  const { t } = useI18n();
  const notify = useNotify();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [pin, setPin] = useState('');

  const load = useCallback(() => {
    listAccounts()
      .then(setAccounts)
      .catch(() => notify(t.genericError, 'error'));
  }, [notify, t]);
  useEffect(load, [load]);

  const save = async (account: AccountRow) => {
    const value = normalizeDigits(pin);
    if (!/^\d{4,8}$/.test(value)) return notify(t.pinFormat, 'error');
    try {
      await setAccountPin(account.id, value);
      notify(t.pinSet(account.label), 'success');
      setEditing(null);
      setPin('');
      load();
    } catch {
      notify(t.genericError, 'error');
    }
  };

  const reset = async (account: AccountRow) => {
    try {
      await resetAccountPin(account.id);
      notify(t.resetPinDone(account.label), 'success');
      setResetting(null);
      load();
    } catch {
      notify(t.genericError, 'error');
    }
  };

  return (
    <Card title={t.tabPins} icon="key">
      <p className="text-sm text-muted">{t.pinsHint}</p>
      <ul className="flex flex-col gap-2">
        {accounts.map((account) => (
          <li key={account.id} className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-3">
            <div className="flex items-center gap-3">
              <span
                className={`h-2.5 w-2.5 rounded-full ${account.hasPin ? 'bg-free' : 'bg-line'}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold" dir="ltr">
                  {account.label}
                </div>
                <div className={`text-xs ${account.onDefaultPin ? 'font-semibold text-promo' : 'text-muted'}`}>
                  {account.onDefaultPin ? t.onDefaultPin : account.hasPin ? t.hasPin : t.noPin}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setResetting(resetting === account.id ? null : account.id);
                  setEditing(null);
                }}
                className="press shrink-0 rounded-xl bg-surface px-3 py-2 text-sm font-semibold text-promo shadow-sm"
              >
                {t.resetPin}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(editing === account.id ? null : account.id);
                  setResetting(null);
                  setPin('');
                }}
                className="press shrink-0 rounded-xl bg-surface px-3 py-2 text-sm font-semibold text-primary shadow-sm"
              >
                {t.setPin}
              </button>
            </div>
            {resetting === account.id ? (
              <div className="animate-rise flex flex-col gap-2 rounded-xl bg-promo-bg p-3">
                <p className="text-sm text-promo">{t.resetPinConfirm(account.label, account.kind === 'branch')}</p>
                <button
                  type="button"
                  onClick={() => void reset(account)}
                  className="press h-11 rounded-xl bg-primary font-semibold text-primary-fg"
                >
                  {t.resetPin}
                </button>
              </div>
            ) : null}
            {editing === account.id ? (
              <form
                className="animate-rise flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(account);
                }}
              >
                <input
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                  inputMode="numeric"
                  maxLength={8}
                  minLength={4}
                  autoFocus
                  dir="ltr"
                  aria-label={t.newPin}
                  placeholder="••••"
                  className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-center font-mono text-xl tracking-[0.4em]"
                />
                <button type="submit" className="press h-12 rounded-xl bg-primary px-4 font-semibold text-primary-fg">
                  {t.save}
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
