import { DomainError } from './errors.ts';

/**
 * A monetary amount in integer piasters (1 EGP = 100 piasters).
 * All arithmetic is done on integers so totals never drift from floating-point error.
 */
export type Money = number;

export function assertMoney(value: number, label = 'amount'): asserts value is Money {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainError('INVALID_MONEY', `${label} must be a non-negative integer number of piasters, got ${value}`);
  }
}

export function assertPercent(value: number, label = 'percent'): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new DomainError('INVALID_PERCENT', `${label} must be between 0 and 100, got ${value}`);
  }
}

/** Converts pounds (e.g. 799.95 from a spreadsheet) to piasters. */
export function fromPounds(pounds: number): Money {
  if (!Number.isFinite(pounds) || pounds < 0) {
    throw new DomainError('INVALID_MONEY', `pounds must be a non-negative number, got ${pounds}`);
  }
  // toPrecision(15) strips binary noise such as 1.005 * 100 = 100.49999999999999.
  return Math.round(Number((pounds * 100).toPrecision(15)));
}

/** Converts piasters to pounds for display or export. */
export function toPounds(amount: Money): number {
  return amount / 100;
}

/** Integer division rounded half-up. Both arguments must be non-negative safe integers. */
function divideRoundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

/**
 * Applies a percentage discount and rounds the result half-up to the nearest piaster.
 * Percent may have up to two decimals (e.g. 12.5); it is handled in basis points.
 */
export function applyDiscount(price: Money, percent: number): Money {
  assertMoney(price, 'price');
  assertPercent(percent);
  const basisPoints = Math.round(percent * 100);
  return divideRoundHalfUp(price * (10_000 - basisPoints), 10_000);
}
