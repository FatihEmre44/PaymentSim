import { errorCodes, LedgerError } from './errors.js';
import { assertPositiveKurus, MAX_ENTRY_KURUS, MIN_ENTRY_KURUS } from './money.js';

// Agreed accounting directions only. This module does not decide state transitions.
const directions = Object.freeze({
  RESERVE: ['AVAILABLE', 'RESERVED'],
  RELEASE: ['RESERVED', 'AVAILABLE'],
  CAPTURE: ['RESERVED', 'SIMULATED_OUTGOING'],
});

export function assertBalancedEntries(entries) {
  const invalid = () => new LedgerError(errorCodes.INVALID_JOURNAL, 'Journal entries must be nonzero, distinct and balanced');
  if (!Array.isArray(entries) || entries.length < 2) throw invalid();
  let total = 0n;
  const accountIds = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.accountId !== 'string' || !entry.accountId ||
        accountIds.has(entry.accountId) || typeof entry.amountKurus !== 'bigint' ||
        entry.amountKurus === 0n || entry.amountKurus < MIN_ENTRY_KURUS || entry.amountKurus > MAX_ENTRY_KURUS) {
      throw invalid();
    }
    accountIds.add(entry.accountId);
    total += entry.amountKurus;
  }
  if (total !== 0n) throw invalid();
}

export function createTransferJournal({ entryType, companyId, paymentId, amountKurus, source, destination }) {
  assertPositiveKurus(amountKurus);
  const direction = directions[entryType];
  if (!direction || !source || !destination ||
      source.companyId !== companyId || destination.companyId !== companyId ||
      source.currency !== 'TRY' || destination.currency !== 'TRY' ||
      source.accountType !== direction[0] || destination.accountType !== direction[1]) {
    throw new LedgerError(errorCodes.INVALID_JOURNAL, 'Accounts must match the company, TRY currency and accounting direction');
  }
  const entries = [
    Object.freeze({ accountId: source.accountId, amountKurus: -amountKurus }),
    Object.freeze({ accountId: destination.accountId, amountKurus }),
  ];
  assertBalancedEntries(entries);
  return Object.freeze({ companyId, paymentId, entryType, entries: Object.freeze(entries) });
}
