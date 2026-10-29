import { errorCodes, LedgerError } from './errors.js';

export const MAX_ENTRY_KURUS = 9223372036854775807n;
export const MIN_ENTRY_KURUS = -9223372036854775808n;

// The existing public contract accepts JSON safe integers, never rounded money.
export function parseAmountKurus(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new LedgerError(errorCodes.INVALID_INPUT, 'amountKurus must be a positive safe integer');
  }
  return BigInt(value);
}

export function assertPositiveKurus(value) {
  if (typeof value !== 'bigint' || value <= 0n || value > MAX_ENTRY_KURUS) {
    throw new LedgerError(errorCodes.INVALID_INPUT, 'amountKurus is outside the positive PostgreSQL bigint range');
  }
}
