import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type Tone = 'info' | 'success' | 'error';
const NotifyContext = createContext<(message: string, tone?: Tone) => void>(() => undefined);

/** Short messages that float under the header and fade out on their own. */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; tone: Tone; key: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const notify = useCallback((message: string, tone: Tone = 'info') => {
    setToast({ message, tone, key: Date.now() });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);
  const toneClass =
    toast?.tone === 'success'
      ? 'bg-free text-white'
      : toast?.tone === 'error'
        ? 'bg-danger text-white'
        : 'bg-fg text-white';
  return (
    <NotifyContext.Provider value={notify}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+12px)] z-50 flex justify-center px-4"
      >
        {toast ? (
          <div
            key={toast.key}
            className={`animate-pop rounded-full px-4 py-2.5 text-sm font-semibold shadow-card ${toneClass}`}
          >
            {toast.message}
          </div>
        ) : null}
      </div>
    </NotifyContext.Provider>
  );
}

export function useNotify() {
  return useContext(NotifyContext);
}
