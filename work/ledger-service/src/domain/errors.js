export class LedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}

export const errorCodes = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  RESERVATION_CONFLICT: 'RESERVATION_CONFLICT',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  INVALID_JOURNAL: 'INVALID_JOURNAL',
  RESERVATION_ALREADY_EXISTS: 'RESERVATION_ALREADY_EXISTS',
  DATABASE_MISMATCH: 'DATABASE_MISMATCH',
});
