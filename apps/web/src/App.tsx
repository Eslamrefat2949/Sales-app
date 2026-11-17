import type { Invoice } from '@ravin-sales/domain';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BRANCH, DEVICE_NO } from './config/demo.ts';
import { CheckoutView, type CheckoutResult } from './features/checkout/CheckoutView.tsx';
import { ConfirmationView } from './features/checkout/ConfirmationView.tsx';
import { ReportView } from './features/report/ReportView.tsx';
import { SellView } from './features/sell/SellView.tsx';
import { useI18n } from './i18n/I18nProvider.tsx';
import { businessDateOf } from './lib/format.ts';
import { useCart } from './state/cart.ts';
import { useInvoiceStore } from './state/invoices.ts';

type View =
  | { readonly name: 'sell' }
  | { readonly name: 'report' }
  | { readonly name: 'checkout' }
  | { readonly name: 'done'; readonly invoice: Invoice };

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

function useToast(): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const notify = useCallback((next: string) => {
    setMessage(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 1600);
  }, []);
  return [message, notify];
}

export function App() {
  const { t, lang, toggleLanguage } = useI18n();
  const [view, setView] = useState<View>({ name: 'sell' });
  const { cart, priced, dispatch } = useCart();
  const store = useInvoiceStore();
  const online = useOnline();
  const [toast, notify] = useToast();
  const businessDate = businessDateOf(new Date());

  const confirm = (result: CheckoutResult) => {
    const invoice = store.createInvoice({
      createdAt: new Date().toISOString(),
      businessDate,
      salesPersonId: result.salesPersonId,
      customer: result.customer,
      lines: priced.units,
      offer: cart.offer,
      totals: priced.totals,
      payments: result.payments,
      change: result.change,
    });
    dispatch({ type: 'clear' });
    setView({ name: 'done', invoice });
    window.scrollTo(0, 0);
  };

  const showTabs = view.name === 'sell' || view.name === 'report';

  return (
    <div className="flex min-h-full flex-col">
      <header className="top-safe sticky z-30 border-b border-line bg-surface">
        <div className="gutter mx-auto flex max-w-3xl items-center gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold tracking-tight">{t.appName}</span>
              <span className="rounded-full bg-promo-bg px-2 py-0.5 text-[11px] font-semibold text-promo">
                {t.demoData}
              </span>
            </div>
            <div className="truncate text-xs text-muted">
              {BRANCH.name[lang]} · <bdi dir="ltr">{t.branchDevice(BRANCH.code, DEVICE_NO)}</bdi>
            </div>
          </div>
          <span
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${online ? 'bg-free-bg text-free' : 'bg-danger-bg text-danger'}`}
          >
            <span className={`h-2 w-2 rounded-full ${online ? 'bg-free' : 'bg-danger'}`} aria-hidden="true" />
            {online ? t.online : t.offline}
          </span>
          <button
            type="button"
            onClick={toggleLanguage}
            lang={lang === 'ar' ? 'en' : 'ar'}
            className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold"
          >
            {t.otherLanguage}
          </button>
        </div>
        {showTabs ? (
          <nav className="gutter mx-auto flex max-w-3xl gap-1 pb-2" aria-label={t.appName}>
            {(['sell', 'report'] as const).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setView(name === 'sell' ? { name: 'sell' } : { name: 'report' })}
                aria-current={view.name === name ? 'page' : undefined}
                className={`flex-1 rounded-xl py-2 text-sm font-semibold ${view.name === name ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted'}`}
              >
                {name === 'sell' ? t.tabSell : t.tabReport}
              </button>
            ))}
          </nav>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1">
        {view.name === 'sell' ? (
          <SellView
            cart={cart}
            priced={priced}
            dispatch={dispatch}
            onCheckout={() => setView({ name: 'checkout' })}
            notify={notify}
          />
        ) : view.name === 'checkout' ? (
          <CheckoutView
            priced={priced}
            knownCustomers={store.knownCustomers}
            onBack={() => setView({ name: 'sell' })}
            onConfirm={confirm}
          />
        ) : view.name === 'done' ? (
          <ConfirmationView invoice={view.invoice} onNewSale={() => setView({ name: 'sell' })} />
        ) : (
          <ReportView
            invoices={store.invoices}
            businessDate={businessDate}
            onVoid={(number, reason) => {
              store.voidInvoice(number, businessDate, reason);
              notify(t.voidedToast(number));
            }}
            notify={notify}
          />
        )}
      </main>

      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+7rem)] z-50 flex justify-center px-4"
      >
        {toast ? (
          <div className="rounded-full bg-fg px-4 py-2 text-sm font-medium text-bg shadow-lg">{toast}</div>
        ) : null}
      </div>
    </div>
  );
}
