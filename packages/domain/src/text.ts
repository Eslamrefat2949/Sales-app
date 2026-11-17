const ARABIC_INDIC_ZERO = 0x0660; // ٠
const EASTERN_ARABIC_INDIC_ZERO = 0x06f0; // ۰ (Persian keyboards)

/**
 * Converts Arabic-Indic digits to Latin digits. Phones set to Arabic often type ٠١٢٣ on the numeric
 * keypad, and codes, mobile numbers and amounts must match either way.
 */
export function normalizeDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const base = code >= EASTERN_ARABIC_INDIC_ZERO ? EASTERN_ARABIC_INDIC_ZERO : ARABIC_INDIC_ZERO;
    return String(code - base);
  });
}
