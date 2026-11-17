import { useEffect } from 'react';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Icon } from './Icon.tsx';

export const PIN_MIN = 4;
export const PIN_MAX = 8;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'] as const;
type Key = (typeof KEYS)[number];

export function isPinFormat(pin: string): boolean {
  return pin.length >= PIN_MIN && pin.length <= PIN_MAX && /^[0-9]+$/.test(pin);
}

interface PinPadProps {
  readonly value: string;
  readonly onChange: (pin: string) => void;
  /** Called with ✓, Enter, or straight away when the last allowed digit is typed. */
  readonly onSubmit: (pin: string) => void;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly message?: string | null;
  readonly messageTone?: 'muted' | 'danger';
  /** Changing this key replays the shake animation (after a wrong PIN). */
  readonly shakeKey?: number;
  readonly submitLabel: string;
}

/**
 * Large on-screen keypad for a 4 to 8 digit PIN: dots for the digits typed, ✓ to confirm.
 * Also works with a hardware keyboard (digits, Backspace, Enter).
 */
export function PinPad({
  value,
  onChange,
  onSubmit,
  disabled = false,
  busy = false,
  message = null,
  messageTone = 'danger',
  shakeKey = 0,
  submitLabel,
}: PinPadProps) {
  const { t } = useI18n();

  const press = (key: Key) => {
    if (busy || disabled) return;
    if (key === 'back') return onChange(value.slice(0, -1));
    if (key === 'ok') {
      if (isPinFormat(value)) onSubmit(value);
      return;
    }
    if (value.length >= PIN_MAX) return;
    const next = value + key;
    onChange(next);
    if (next.length === PIN_MAX) onSubmit(next);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
      // The keypad handles the key itself, so a focused keypad button must not also be "clicked".
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        press(event.key as Key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        press('back');
      } else if (event.key === 'Enter') {
        event.preventDefault();
        press('ok');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Four dots to start with; more appear as a longer PIN is typed.
  const slots = Math.min(PIN_MAX, Math.max(PIN_MIN, value.length + (value.length >= PIN_MIN ? 1 : 0)));

  return (
    <div className="flex flex-col gap-4">
      <div key={shakeKey} className={`flex flex-col items-center gap-3 pt-1 ${shakeKey ? 'animate-pop' : ''}`}>
        <div className="flex gap-3" dir="ltr" aria-live="polite" aria-label={`${value.length}`}>
          {Array.from({ length: slots }, (_, index) => (
            <span
              key={index}
              className={`h-4 w-4 rounded-full transition duration-150 ${
                index < value.length ? 'scale-110 bg-primary' : 'bg-surface-2 ring-1 ring-line'
              }`}
            />
          ))}
        </div>
        <p
          className={`min-h-6 text-center text-sm ${message && messageTone === 'danger' ? 'text-danger' : 'text-muted'}`}
          role="status"
        >
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
              aria-label={submitLabel}
              disabled={disabled || busy || !isPinFormat(value)}
              onClick={() => press(key)}
              className="press flex h-15 items-center justify-center rounded-2xl bg-primary text-primary-fg disabled:opacity-35"
            >
              <Icon name="check" className="h-7 w-7" />
            </button>
          ) : (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => press(key)}
              className="press h-15 rounded-2xl bg-surface-2 font-display text-2xl font-medium tabular disabled:opacity-40"
            >
              {key}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
