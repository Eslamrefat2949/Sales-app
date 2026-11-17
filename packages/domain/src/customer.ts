import { normalizeDigits } from './text.ts';

/** Egyptian mobile: 010, 011, 012 or 015 followed by 8 digits. */
const EGYPTIAN_MOBILE = /^01[0125]\d{8}$/;

/**
 * Normalizes what the seller typed into the 11-digit local format (01XXXXXXXXX).
 * Accepts Arabic digits, spaces, dashes and the +20 / 0020 country prefix. Returns null if invalid.
 */
export function normalizeEgyptianMobile(input: string): string | null {
  let digits = normalizeDigits(input).replace(/[\s\-().]/g, '');
  if (digits.startsWith('+20')) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith('0020')) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith('20') && digits.length === 12) digits = `0${digits.slice(2)}`;
  return EGYPTIAN_MOBILE.test(digits) ? digits : null;
}
