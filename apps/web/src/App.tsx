import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { ToastProvider } from './components/Toast.tsx';
import { loadAppData, type LoadedData } from './data/appData.ts';
import { signOut } from './data/session.ts';
import { AdminApp } from './features/admin/AdminApp.tsx';
import { BranchApp } from './features/branch/BranchApp.tsx';
import { LoginScreen, Wordmark } from './features/login/LoginScreen.tsx';
import { useI18n } from './i18n/I18nProvider.tsx';
import { supabase } from './lib/supabase.ts';

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <ToastProvider>
      {session === undefined ? (
        <Splash />
      ) : session ? (
        <SignedIn key={session.user.id} userId={session.user.id} />
      ) : (
        <LoginScreen />
      )}
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
  return state.data.config.account.kind === 'admin' ? <AdminApp data={state.data} /> : <BranchApp data={state.data} />;
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
