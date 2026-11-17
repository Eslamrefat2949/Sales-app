import { useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { PinPad } from '../../components/PinPad.tsx';
import { changeOwnPin, signOut } from '../../data/session.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { tick } from '../../lib/storage.ts';
import { Wordmark } from './LoginScreen.tsx';

/** Same rule as the server: not the default, not one digit repeated, not a straight run. */
export function isWeakPin(pin: string): boolean {
  return pin === '1234' || /^(\d)\1+$/.test(pin) || '01234567890'.includes(pin) || '09876543210'.includes(pin);
}

type Step = 'current' | 'new' | 'confirm';

interface ChangePinScreenProps {
  readonly accountId: string;
  readonly accountLabel: string;
  /**
   * forced: first sign-in on a temporary PIN, nothing else is possible until a PIN is chosen.
   * voluntary: from the account menu, the current PIN is asked first and the screen can be closed.
   */
  readonly mode: 'forced' | 'voluntary';
  readonly onDone: () => void;
  readonly onCancel?: () => void;
}

export function ChangePinScreen({ accountId, accountLabel, mode, onDone, onCancel }: ChangePinScreenProps) {
  const { t, lang, toggleLanguage } = useI18n();
  const [step, setStep] = useState<Step>(mode === 'forced' ? 'new' : 'current');
  const [current, setCurrent] = useState('');
  const [fresh, setFresh] = useState('');
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  const fail = (text: string, back: Step) => {
    setMessage(text);
    setPin('');
    setStep(back);
    setShake((value) => value + 1);
    tick();
  };

  const submit = async (value: string) => {
    if (step === 'current') {
      setCurrent(value);
      setPin('');
      setMessage(null);
      setStep('new');
      return;
    }
    if (step === 'new') {
      if (isWeakPin(value)) return fail(t.pinWeak, 'new');
      setFresh(value);
      setPin('');
      setMessage(null);
      setStep('confirm');
      return;
    }
    if (value !== fresh) return fail(t.pinMismatch, 'new');
    setBusy(true);
    const result = await changeOwnPin(accountId, mode === 'forced' ? null : current, fresh);
    setBusy(false);
    if (result.ok) {
      onDone();
      return;
    }
    if (result.reason === 'WRONG_PIN') return fail(t.pinWrongCurrent, 'current');
    if (result.reason === 'PIN_WEAK') return fail(t.pinWeak, 'new');
    if (result.reason === 'PIN_SAME') return fail(t.pinSame, 'new');
    fail(
      result.reason === 'LOCKED' ? t.pinLocked : result.reason === 'OFFLINE' ? t.pinOffline : t.genericError,
      mode === 'forced' ? 'new' : 'current',
    );
  };

  const prompt = step === 'current' ? t.stepCurrentPin : step === 'new' ? t.stepNewPin : t.stepConfirmPin;
  const steps: readonly Step[] = mode === 'forced' ? ['new', 'confirm'] : ['current', 'new', 'confirm'];

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-bg">
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
          <h1 className="font-display text-3xl font-semibold">
            {mode === 'forced' ? t.firstPinTitle : t.changePinTitle}
          </h1>
          <p className="mt-1 text-sm text-white/85">
            <bdi dir="ltr">{accountLabel}</bdi>
          </p>
        </div>
      </header>

      <main className="gutter mx-auto -mt-14 flex w-full max-w-md flex-1 flex-col gap-5 pb-8">
        <section className="animate-rise flex flex-col gap-4 rounded-3xl bg-surface p-5 shadow-card">
          {mode === 'forced' ? (
            <p className="rounded-2xl bg-tile-blue p-3 text-sm font-medium text-tile-blue-fg">{t.firstPinHint}</p>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold">{prompt}</p>
            <div className="flex gap-1.5" aria-hidden="true">
              {steps.map((name) => (
                <span
                  key={name}
                  className={`h-1.5 w-6 rounded-full ${
                    steps.indexOf(name) <= steps.indexOf(step) ? 'bg-primary' : 'bg-surface-2'
                  }`}
                />
              ))}
            </div>
          </div>
          <PinPad
            key={step}
            value={pin}
            onChange={(next) => {
              setPin(next);
              if (next.length === 1) setMessage(null);
            }}
            onSubmit={(value) => void submit(value)}
            busy={busy}
            message={message}
            shakeKey={shake}
            submitLabel={t.save}
          />
        </section>
        {mode === 'forced' ? (
          <button
            type="button"
            onClick={() => void signOut()}
            className="press flex items-center justify-center gap-2 self-center text-sm font-semibold text-muted"
          >
            <Icon name="logout" className="h-4 w-4" />
            {t.signOut}
          </button>
        ) : (
          <button
            type="button"
            onClick={onCancel}
            className="press self-center rounded-xl px-4 py-2 text-sm font-semibold text-primary"
          >
            {t.cancel}
          </button>
        )}
      </main>
    </div>
  );
}
