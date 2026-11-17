import { normalizeDigits } from './text.ts';

export interface SearchableItem {
  /** One letter followed by digits, e.g. "A12345". */
  readonly itemCode: string;
  readonly name: string;
}

const LETTER_PREFIX = /^[A-Z]+/;

/** Lower rank = better match. */
function rankMatch(item: SearchableItem, code: string, nameQuery: string): number | null {
  const itemCode = item.itemCode.toUpperCase();
  const digits = itemCode.replace(LETTER_PREFIX, '');
  if (itemCode === code || digits === code) return 0;
  if (itemCode.startsWith(code) || digits.startsWith(code)) return 1;
  if (itemCode.includes(code)) return 2;
  if (nameQuery.length >= 2 && item.name.toLowerCase().includes(nameQuery)) return 3;
  return null;
}

/**
 * Searches the local catalog as the seller types. Typing only the digits finds the item even though
 * its code starts with a letter, so the numeric keypad is enough on the phone.
 * Order: exact code, code prefix, code contains, name contains.
 */
export function searchCatalog<T extends SearchableItem>(items: readonly T[], query: string, limit = 20): T[] {
  const nameQuery = normalizeDigits(query).trim().toLowerCase();
  const code = nameQuery.toUpperCase().replace(/\s+/g, '');
  if (code === '') return [];

  const matches: { item: T; rank: number }[] = [];
  for (const item of items) {
    const rank = rankMatch(item, code, nameQuery);
    if (rank !== null) matches.push({ item, rank });
  }
  return matches
    .sort((a, b) => a.rank - b.rank || a.item.itemCode.localeCompare(b.item.itemCode, 'en', { numeric: true }))
    .slice(0, limit)
    .map((match) => match.item);
}

const LETTER_SIZE_RANK: Readonly<Record<string, number>> = {
  XXS: 0,
  XS: 1,
  S: 2,
  M: 3,
  L: 4,
  XL: 5,
  XXL: 6,
  '2XL': 6,
  XXXL: 7,
  '3XL': 7,
  '4XL': 8,
  '5XL': 9,
};

type SizeKey = readonly [group: number, rank: number, text: string];

function sizeKey(size: string): SizeKey {
  const normalized = size.trim().toUpperCase();
  const letterRank = LETTER_SIZE_RANK[normalized];
  if (letterRank !== undefined) return [0, letterRank, normalized];
  const leadingNumber = /^\d+(\.\d+)?/.exec(normalized);
  if (leadingNumber) return [1, Number(leadingNumber[0]), normalized];
  return [2, 0, normalized];
}

/** Orders sizes the way a seller expects: XS S M L XL, then 36 38 40 or 2-3Y 4-5Y, then anything else. */
export function sortSizes(sizes: readonly string[]): string[] {
  return [...sizes].sort((a, b) => {
    const [groupA, rankA, textA] = sizeKey(a);
    const [groupB, rankB, textB] = sizeKey(b);
    return groupA - groupB || rankA - rankB || textA.localeCompare(textB, 'en', { numeric: true });
  });
}
