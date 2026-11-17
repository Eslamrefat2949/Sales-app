import type { Invoice } from '@ravin-sales/domain';
import { useMemo, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { useNotify } from '../../components/Toast.tsx';
import type { LoadedData } from '../../data/appData.ts';
import { toPayload, useBranchSync, type BranchSync } from '../../data/branchSync.ts';
import { signOut } from '../../data/session.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { businessDateOf } from '../../lib/format.ts';
import { useCart } from '../../state/cart.ts';
import { CheckoutView, type CheckoutResult } from '../checkout/CheckoutView.tsx';
import { ConfirmationView } from '../checkout/ConfirmationView.tsx';
import { ChangePinScreen } from '../login/ChangePinScreen.tsx';
import { Wordmark } from '../login/LoginScreen.tsx';
import { ReportView } from '../report/ReportView.tsx';
import { SellView } from '../sell/SellView.tsx';

type View =
  | { readonly name: 'sell' }
  | { readonly name: 'report' }
  | { readonly name: 'checkout' }
  | { readonly name: 'done'; readonly invoice: Invoice };

export function BranchApp({ data }: { readonly data: LoadedData }) {
  const { config, catalog } = data;
  const branch = config.branch!;
  const { t } = useI18n();
  const notify = useNotify();
  const sync = useBranchSync(config);
  const pricing = useMemo(() => ({ defaultDiscountPercent: config.defaultDiscountPercent }), [config]);
  const { cart, priced, dispatch } = useCart(`cart:${branch.id}`, pricing);
  const [view, setView] = useState<View>({ name: 'sell' });

  const confirm = async (result: CheckoutResult) => {
    const reserved = await sync.takeNumber();
    if (!reserved) {
      notify(t.noNumbers, 'error');
      void sync.syncNow();
      return;
    }
    const now = new Date();
    const invoice: Invoice = {
      number: reserved.number,
      branchCode: branch.code,
      deviceNo: reserved.device.number,
      createdAt: now.toISOString(),
      businessDate: businessDateOf(now),
      salesPersonId: result.salesPersonId,
      customer: result.customer,
      lines: priced.units,
      offer: cart.offer,
      totals: priced.totals,
      payments: result.payments,
      change: result.change,
      status: 'completed',
      exportedAt: null,
      void: null,
    };
    await sync.enqueue(
      toPayload(invoice, {
        seq: reserved.seq,
        deviceId: reserved.device.id,
        defaultDiscountPercent: config.defaultDiscountPercent,
      }),
    );
    dispatch({ type: 'clear' });
    setView({ name: 'done', invoice });
    window.scrollTo(0, 0);
  };

  const showTabs = view.name === 'sell' || view.name === 'report';

  return (
    <div className="flex min-h-full flex-col">
      <BranchHeader
        account={data.config.account}
        title={branch.posName}
        subtitle={`${branch.code}${sync.device ? ` · ${t.phoneLabel(sync.device.number)}` : ''}`}
        sync={sync}
        offline={data.offline}
      >
        {showTabs ? (
          <nav className="flex gap-2" aria-label={t.appSub}>
            {(['sell', 'report'] as const).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setView(name === 'sell' ? { name: 'sell' } : { name: 'report' })}
                aria-current={view.name === name ? 'page' : undefined}
                className={`press flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  view.name === name ? 'bg-white text-primary shadow-card' : 'bg-white/15 text-white'
                }`}
              >
                <Icon name={name === 'sell' ? 'tag' : 'chart'} className="h-4 w-4" />
                {name === 'sell' ? t.tabSell : t.tabReport}
              </button>
            ))}
          </nav>
        ) : null}
      </BranchHeader>

      <main className="mx-auto w-full max-w-3xl flex-1">
        {view.name === 'sell' ? (
          <SellView
            config={config}
            catalog={catalog}
            cart={cart}
            priced={priced}
            dispatch={dispatch}
            onCheckout={() => setView({ name: 'checkout' })}
          />
        ) : view.name === 'checkout' ? (
          <CheckoutView config={config} priced={priced} onBack={() => setView({ name: 'sell' })} onConfirm={confirm} />
        ) : view.name === 'done' ? (
          <ConfirmationView config={config} invoice={view.invoice} onNewSale={() => setView({ name: 'sell' })} />
        ) : (
          <ReportView config={config} sync={sync} />
        )}
      </main>
    </div>
  );
}

/** Blue header with the page title, the sync state and the account menu. */
export function BranchHeader({
  account,
  title,
  subtitle,
  sync,
  offline,
  children,
}: {
  readonly account: { readonly id: string; readonly label: string };
  readonly title: string;
  readonly subtitle: string;
  readonly sync?: BranchSync;
  readonly offline: boolean;
  readonly children?: ReactNode;
}) {
  const { t, lang, toggleLanguage } = useI18n();
  const notify = useNotify();
  const [menuOpen, setMenuOpen] = useState(false);
  const [changingPin, setChangingPin] = useState(false);
  const online = sync ? sync.online : !offline;
  const pending = sync?.pending.length ?? 0;

  return (
    <header className="hero gutter pt-safe rounded-b-[28px] pb-4 shadow-card">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <Wordmark />
          <div className="flex items-center gap-1.5">
            <span
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                !online ? 'bg-danger text-white' : pending > 0 ? 'bg-amber-400 text-fg' : 'bg-white/18 text-white'
              }`}
            >
              <Icon name={online ? 'cloud' : 'cloudOff'} className="h-4 w-4" />
              {!online ? t.offline : pending > 0 ? t.syncPending(pending) : t.online}
            </span>
            <button
              type="button"
              onClick={toggleLanguage}
              lang={lang === 'ar' ? 'en' : 'ar'}
              className="press rounded-full bg-white/18 px-2.5 py-1 text-xs font-semibold"
            >
              {lang === 'ar' ? 'EN' : 'ع'}
            </button>
            <button
              type="button"
              aria-label={t.accountMenu}
              onClick={() => setMenuOpen(true)}
              className="press flex h-8 w-8 items-center justify-center rounded-full bg-white/18"
            >
              <Icon name="logout" className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div>
          <h1 className="font-display text-2xl leading-tight font-semibold" dir="ltr">
            {title}
          </h1>
          <p className="text-sm text-white/80">{subtitle}</p>
        </div>
        {children}
      </div>
      {menuOpen ? (
        <Sheet
          title={t.accountMenu}
          subtitle={<bdi dir="ltr">{account.label}</bdi>}
          closeLabel={t.cancel}
          onClose={() => setMenuOpen(false)}
        >
          <div className="flex flex-col gap-3 pb-2 text-fg">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setChangingPin(true);
              }}
              className="press flex h-14 items-center justify-center gap-2 rounded-2xl bg-primary-soft text-lg font-semibold text-primary"
            >
              <Icon name="key" />
              {t.changePinTitle}
            </button>
            {pending > 0 ? <p className="rounded-2xl bg-promo-bg p-3 text-promo">{t.signOutPending(pending)}</p> : null}
            <button
              type="button"
              onClick={() => void signOut()}
              className="press h-14 rounded-2xl bg-danger text-lg font-semibold text-white"
            >
              {t.signOut}
            </button>
          </div>
        </Sheet>
      ) : null}
      {changingPin ? (
        <ChangePinScreen
          accountId={account.id}
          accountLabel={account.label}
          mode="voluntary"
          onCancel={() => setChangingPin(false)}
          onDone={() => {
            setChangingPin(false);
            notify(t.pinChanged, 'success');
          }}
        />
      ) : null}
    </header>
  );
}
