import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { loadDirectory, signInWithPin, type DirectoryEntry } from '../../data/session.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { readJson, tick, writeJson } from '../../lib/storage.ts';

const PIN_LENGTH = 6;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'] as const;
type Key = (typeof KEYS)[number];

/** Pick the branch (or your name) from a list, then type the PIN on a large keypad. */
export function LoginScreen() {
  const { t, lang, toggleLanguage } = useI18n();
  const [directory, setDirectory] = useState<DirectoryEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [kind, setKind] = useState<'branch' | 'admin'>(() => readJson<'branch' | 'admin'>('login-kind', 'branch'));
  const [accountId, setAccountId] = useState(() => readJson<string>('login-account', ''));
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [shake, setShake] = useState(0);

  const load = () => {
    setLoadError(false);
    loadDirectory()
      .then(setDirectory)
      .catch(() => setLoadError(true));
  };
  useEffect(load, []);

  const options = useMemo(() => (directory ?? []).filter((entry) => entry.kind === kind), [directory, kind]);
  const selected =
    options.find((entry) => entry.accountId === accountId) ?? (options.length === 1 ? options[0]! : null);

  const submit = async (code: string) => {
    if (!selected || code.length !== PIN_LENGTH || busy) return;
    setBusy(true);
    setMessage(null);
    const result = await signInWithPin(selected.accountId, code);
    setBusy(false);
    if (result.ok) {
      writeJson('login-kind', kind);
      writeJson('login-account', selected.accountId);
      return;
    }
    setPin('');
    setShake((value) => value + 1);
    tick();
    setMessage(
      result.reason === 'WRONG_PIN'
        ? t.pinWrong(result.attemptsLeft)
        : result.reason === 'LOCKED'
          ? t.pinLocked
          : result.reason === 'OFFLINE'
            ? t.pinOffline
            : t.pinFailed,
    );
  };

  const press = (key: Key) => {
    if (busy || !selected) return;
    if (key === 'back') return setPin((current) => current.slice(0, -1));
    if (key === 'ok') return void submit(pin);
    if (pin.length >= PIN_LENGTH) return;
    const next = pin + key;
    setPin(next);
    if (next.length === PIN_LENGTH) void submit(next);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLSelectElement) return;
      if (/^[0-9]$/.test(event.key)) press(event.key as Key);
      else if (event.key === 'Backspace') press('back');
      else if (event.key === 'Enter') press('ok');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="flex min-h-full flex-col bg-bg">
      <header className="hero gutter pt-safe pb-20">
        <div className="mx-auto flex max-w-md items-center justify-between pt-1">
          <Wordmark />
          <button
            type="button"
            onClick={toggleLanguage}
            lang={lang === 'ar' ? 'en' : 'ar'}
            className="press rounded-full bg-white/18 px-3.5 py-1.5 text-sm font-medium backdrop-blur"
          >
            {t.otherLanguage}
          </button>
        </div>
        <div className="mx-auto mt-8 max-w-md">
          <h1 className="font-display text-3xl font-semibold">{t.loginTitle}</h1>
          <p className="mt-1 text-sm text-white/80">{t.enterPin}</p>
        </div>
      </header>

      <main className="gutter mx-auto -mt-14 flex w-full max-w-md flex-1 flex-col gap-5 pb-8">
        <section className="animate-rise flex flex-col gap-4 rounded-3xl bg-surface p-5 shadow-card">
          <div className="grid grid-cols-2 rounded-2xl bg-surface-2 p-1" role="tablist">
            {(['branch', 'admin'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={kind === option}
                onClick={() => {
                  setKind(option);
                  setPin('');
                  setMessage(null);
                }}
                className={`rounded-xl py-2.5 text-sm font-semibold transition ${
                  kind === option ? 'bg-primary text-primary-fg shadow-card' : 'text-muted'
                }`}
              >
                {option === 'branch' ? t.loginBranch : t.loginAdmin}
              </button>
            ))}
          </div>

          {loadError ? (
            <div className="flex flex-col gap-3 rounded-2xl bg-danger-bg p-4 text-danger">
              <p>{navigator.onLine ? t.pinFailed : t.pinOffline}</p>
              <button
                type="button"
                onClick={load}
                className="press self-start rounded-xl bg-danger px-4 py-2 font-semibold text-white"
              >
                {t.retry}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-account" className="text-sm font-medium text-muted">
                {kind === 'branch' ? t.chooseBranch : t.chooseName}
              </label>
              <select
                id="login-account"
                dir="ltr"
                value={selected?.accountId ?? ''}
                onChange={(event) => {
                  setAccountId(event.target.value);
                  setPin('');
                  setMessage(null);
                }}
                disabled={!directory}
                className="h-14 rounded-2xl border border-line bg-surface-2 px-4 text-base font-semibold"
              >
                <option value="">{directory ? t.choose : t.signingIn}</option>
                {options.map((entry) => (
                  <option key={entry.accountId} value={entry.accountId}>
                    {entry.label}
                  </option>
                ))}
              </select>
              {directory && options.length === 0 ? <p className="text-sm text-muted">{t.noAccounts}</p> : null}
            </div>
          )}

          <div key={shake} className={`flex flex-col items-center gap-3 pt-1 ${shake ? 'animate-pop' : ''}`}>
            <div className="flex gap-3" dir="ltr" aria-live="polite" aria-label={`${pin.length} / ${PIN_LENGTH}`}>
              {Array.from({ length: PIN_LENGTH }, (_, index) => (
                <span
                  key={index}
                  className={`h-4 w-4 rounded-full transition duration-150 ${
                    index < pin.length ? 'scale-110 bg-primary' : 'bg-surface-2 ring-1 ring-line'
                  }`}
                />
              ))}
            </div>
            <p className={`min-h-6 text-center text-sm ${message ? 'text-danger' : 'text-muted'}`} role="status">
              {busy ? t.signingIn : message}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2.5" dir="ltr">
            {KEYS.map((key) =>
              key === 'back' ? (
                <button
                  key={key}
                  type="button"
                  aria-label={t.deleteDigit}
                  onClick={() => press(key)}
                  className="press flex h-15 items-center justify-center rounded-2xl text-muted"
                >
                  <Icon name="backspace" className="h-7 w-7" />
                </button>
              ) : key === 'ok' ? (
                <button
                  key={key}
                  type="button"
                  aria-label={t.loginTitle}
                  disabled={!selected || pin.length !== PIN_LENGTH || busy}
                  onClick={() => press(key)}
                  className="press flex h-15 items-center justify-center rounded-2xl bg-primary text-primary-fg disabled:opacity-35"
                >
                  <Icon name="check" className="h-7 w-7" />
                </button>
              ) : (
                <button
                  key={key}
                  type="button"
                  disabled={!selected}
                  onClick={() => press(key)}
                  className="press h-15 rounded-2xl bg-surface-2 font-display text-2xl font-medium tabular disabled:opacity-40"
                >
                  {key}
                </button>
              ),
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export function Wordmark() {
  return (
    <div dir="ltr" className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white font-display text-lg font-bold text-primary">
        R
      </span>
      <div className="leading-tight">
        <div className="font-display text-base font-semibold tracking-[0.2em]">RAVIN</div>
        <div className="text-[11px] tracking-[0.18em] text-white/75 uppercase">Sales</div>
      </div>
    </div>
  );
}
