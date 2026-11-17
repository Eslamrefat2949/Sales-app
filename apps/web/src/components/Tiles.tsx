import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatMoney } from '../lib/format.ts';
import { Icon, type IconName } from './Icon.tsx';

/** Counts up to a new value so totals feel alive; jumps straight there when motion is reduced. */
export function useAnimatedNumber(target: number, duration = 450): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const from = fromRef.current;
    if (reduce || from === target) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setValue(Math.round(from + (target - from) * eased));
      if (progress < 1) frame = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

export function AnimatedMoney({ amount, className = '' }: { readonly amount: number; readonly className?: string }) {
  const value = useAnimatedNumber(amount);
  return <bdi className={`tabular whitespace-nowrap ${className}`}>{formatMoney(value)}</bdi>;
}

const TONES = {
  blue: 'bg-tile-blue text-tile-blue-fg',
  green: 'bg-tile-green text-tile-green-fg',
  amber: 'bg-tile-amber text-tile-amber-fg',
  purple: 'bg-tile-purple text-tile-purple-fg',
} as const;

/** Pastel figure tile: label with an icon, value below. */
export function StatTile({
  tone,
  icon,
  label,
  children,
}: {
  readonly tone: keyof typeof TONES;
  readonly icon: IconName;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={`animate-rise flex min-w-0 flex-col gap-2 rounded-2xl p-3.5 ${TONES[tone]}`}>
      <div className="flex items-center justify-between gap-2 text-xs font-semibold">
        <span className="truncate">{label}</span>
        <Icon name={icon} className="h-4 w-4" />
      </div>
      <div className="font-display text-xl font-semibold text-fg">{children}</div>
    </div>
  );
}
