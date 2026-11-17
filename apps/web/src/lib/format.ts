import { fromPounds, normalizeDigits, type Money } from '@ravin-sales/domain';

/** 2010 → "2,010", 559.3 → "559.30". Latin digits in both languages, matching Odoo and receipts. */
export function formatMoney(amount: Money): string {
  return (amount / 100).toLocaleString('en-US', {
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** Parses an amount typed by the seller (Arabic digits and Arabic decimal comma allowed). */
export function parseAmount(input: string): Money | null {
  const cleaned = normalizeDigits(input).replace(/[٫,]/g, '.').replace(/\s/g, '');
  if (cleaned === '') return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return fromPounds(Number(cleaned));
}

/** Formats piasters for an input field: 201000 → "2010", 55930 → "559.30". */
export function moneyToInput(amount: Money): string {
  return amount % 100 === 0 ? String(amount / 100) : (amount / 100).toFixed(2);
}

/** The branch business date (YYYY-MM-DD) in the phone's local time. */
export function businessDateOf(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatTime(iso: string, lang: 'ar' | 'en'): string {
  return new Date(iso).toLocaleTimeString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
