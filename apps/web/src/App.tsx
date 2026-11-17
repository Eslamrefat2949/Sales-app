import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { ToastProvider } from './components/Toast.tsx';
import { loadAppData, type LoadedData } from './data/appData.ts';
import { signOut } from './data/session.ts';
import { AdminApp } from './features/admin/AdminApp.tsx';
import { BranchApp } from './features/branch/BranchApp.tsx';
import { ChangePinScreen } from './features/login/ChangePinScreen.tsx';
import { LoginScreen, Wordmark } from './features/login/LoginScreen.tsx';
import { useI18n } from './i18n/I18nProvider.tsx';
import { withTimeout } from './lib/async.ts';
import { AUTH_STORAGE_KEY, supabase } from './lib/supabase.ts';

/** The account saved on this phone by the last sign-in, if any. */
function savedUserId(): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) ?? 'null') as { user?: { id?: string } } | null;
    return saved?.user?.id ?? null;
  } catch {
    return null;
  }
}

export function App() {
  // undefined while checking, null when signed out.
  const [userId, setUserId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const saved = savedUserId();
    const check = supabase.auth.getSession();
    // With no internet, renewing a sign-in older than an hour keeps retrying for about 30 seconds.
    // A sign-in saved on the phone opens the app straight away instead; it renews by itself once the
    // internet is back, and a sign-in the server no longer accepts sends the phone to the sign-in screen.
    const quick = saved ? withTimeout(check, navigator.onLine ? 4000 : 300) : check;
    quick
      .then(({ data, error }) => {
        if (data.session) setUserId(data.session.user.id);
        else if (error && isAuthRetryableFetchError(error)) setUserId(saved);
        else setUserId(null);
      })
      .catch(() => setUserId(saved));
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (next) setUserId(next.user.id);
      else if (event === 'SIGNED_OUT') setUserId(null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <ToastProvider>
      {userId === undefined ? <Splash /> : userId ? <SignedIn key={userId} userId={userId} /> : <LoginScreen />}
    </ToastProvider>
  );
}

type LoadState =
  | { readonly status: 'loading'; readonly step: 'settings' | 'catalog' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly data: LoadedData };

function SignedIn({ userId }: { readonly userId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading', step: 'settings' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadAppData(userId, (step) => !cancelled && setState({ status: 'loading', step }))
      .then((data) => !cancelled && setState({ status: 'ready', data }))
      .catch((error: unknown) => {
        if (cancelled) return;
        // The account was switched off or its PIN changed: back to the sign-in screen.
        if (String((error as { message?: string })?.message ?? '').startsWith('NO_ACCOUNT')) void signOut();
        else setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, attempt]);

  if (state.status !== 'ready') {
    return <Splash state={state} onRetry={() => setAttempt((value) => value + 1)} />;
  }
  const { account } = state.data.config;
  // On the default PIN nothing else opens until the account has chosen its own PIN.
  if (account.mustChangePin && !state.data.offline) {
    return (
      <ChangePinScreen
        accountId={account.id}
        accountLabel={account.label}
        mode="forced"
        onDone={() => setAttempt((value) => value + 1)}
      />
    );
  }
  return account.kind === 'admin' ? <AdminApp data={state.data} /> : <BranchApp data={state.data} />;
}

function Splash({ state, onRetry }: { readonly state?: LoadState; readonly onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="hero gutter pt-safe flex min-h-full flex-col items-center justify-center gap-6 text-center">
      <div className="animate-pop scale-125">
        <Wordmark />
      </div>
      {state?.status === 'error' ? (
        <div className="flex max-w-xs flex-col items-center gap-3">
          <p>{t.loadFailed}</p>
          <button
            type="button"
            onClick={onRetry}
            className="press rounded-2xl bg-white px-5 py-2.5 font-semibold text-primary"
          >
            {t.retry}
          </button>
          <button type="button" onClick={() => void signOut()} className="text-sm text-white/80 underline">
            {t.signOut}
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <span
            className="h-9 w-9 animate-spin rounded-full border-4 border-white/30 border-t-white"
            aria-hidden="true"
          />
          <p className="text-sm text-white/85">
            {state?.status === 'loading' && state.step === 'catalog' ? t.loadingCatalog : t.loadingSettings}
          </p>
        </div>
      )}
    </div>
  );
}
