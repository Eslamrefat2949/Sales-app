export type DomainErrorCode =
  | 'INVALID_MONEY'
  | 'INVALID_PERCENT'
  | 'INVALID_UNIT'
  | 'INVALID_OFFER'
  | 'OFFER_NOT_APPLICABLE'
  | 'OFFER_INTEGRITY'
  | 'UNIT_NOT_FOUND'
  | 'INVALID_INVOICE'
  | 'VOID_NOT_ALLOWED';

/**
 * Error raised when business rules are violated.
 * `code` is stable and safe to branch on (UI messages, server validation);
 * `message` is for developers and logs only.
 */
export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
