import assert from 'node:assert/strict';
import test from 'node:test';
import { ReservationPolicy } from '../src/domain/reservation-policy.js';
import { assertBalancedEntries, createTransferJournal } from '../src/domain/journal.js';
import { MAX_ENTRY_KURUS } from '../src/domain/money.js';

const companyId = 'abcdefab-1234-1234-1234-123456789abc';
const paymentId = '12345678-1234-1234-1234-123456789abc';
const policy = new ReservationPolicy();
const request = { companyId, paymentId, amountKurus: 125000, currency: 'TRY' };
const account = (type) => ({ accountId: type, companyId, currency: 'TRY', accountType: type });

test('normalizes UUID case and converts safe integer money exactly', () => {
  const input = { ...request, companyId: companyId.toUpperCase(), amountKurus: Number.MAX_SAFE_INTEGER };
  const normalized = policy.validate(input);
  assert.equal(normalized.companyId, companyId);
  assert.equal(normalized.amountKurus, 9007199254740991n);
  assert.equal(typeof input.amountKurus, 'number');
});

test('rejects invalid identifiers, currency and unsafe money', () => {
  for (const amountKurus of [0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '100', 100n, null]) {
    assert.throws(() => policy.validate({ ...request, amountKurus }), { code: 'INVALID_INPUT' });
  }
  for (const changed of [{ paymentId: 'payment-1' }, { companyId: ' ' }, { currency: 'USD' }]) {
    assert.throws(() => policy.validate({ ...request, ...changed }), { code: 'INVALID_INPUT' });
  }
  assert.throws(() => policy.validate(null), { code: 'INVALID_INPUT' });
});

for (const [entryType, from, to] of [
  ['RESERVE', 'AVAILABLE', 'RESERVED'], ['RELEASE', 'RESERVED', 'AVAILABLE'],
  ['CAPTURE', 'RESERVED', 'SIMULATED_OUTGOING'],
]) {
  test(`${entryType} produces exact, balanced entries in the agreed direction`, () => {
    const journal = createTransferJournal({ companyId, paymentId, entryType, amountKurus: MAX_ENTRY_KURUS,
      source: account(from), destination: account(to) });
    assert.deepEqual(journal.entries, [
      { accountId: from, amountKurus: -MAX_ENTRY_KURUS }, { accountId: to, amountKurus: MAX_ENTRY_KURUS },
    ]);
    assertBalancedEntries(journal.entries);
    assert.throws(() => { journal.entries[0].amountKurus = 1n; }, TypeError);
  });
}

test('rejects wrong company, currency, account direction and unsupported journal type', () => {
  const input = { companyId, paymentId, entryType: 'RESERVE', amountKurus: 1n,
    source: account('AVAILABLE'), destination: account('RESERVED') };
  for (const changed of [
    { source: { ...input.source, companyId: paymentId } },
    { destination: { ...input.destination, currency: 'USD' } },
    { source: account('RESERVED') }, { entryType: 'DEMO_FUNDING' },
  ]) assert.throws(() => createTransferJournal({ ...input, ...changed }), { code: 'INVALID_JOURNAL' });
  assert.throws(() => createTransferJournal({ ...input, amountKurus: MAX_ENTRY_KURUS + 1n }), { code: 'INVALID_INPUT' });
});

test('rejects unbalanced, zero, duplicate-account and out-of-range entries', () => {
  for (const entries of [[],
    [{ accountId: 'a', amountKurus: -2n }, { accountId: 'b', amountKurus: 1n }],
    [{ accountId: 'a', amountKurus: 0n }, { accountId: 'b', amountKurus: 0n }],
    [{ accountId: 'a', amountKurus: -1n }, { accountId: 'a', amountKurus: 1n }],
    [{ accountId: 'a', amountKurus: -1 }, { accountId: 'b', amountKurus: 1 }],
    [{ accountId: 'a', amountKurus: -(MAX_ENTRY_KURUS + 1n) }, { accountId: 'b', amountKurus: MAX_ENTRY_KURUS + 1n }],
  ]) assert.throws(() => assertBalancedEntries(entries), { code: 'INVALID_JOURNAL' });
});

test('compares large balances without rounding', () => {
  assert.doesNotThrow(() => policy.assertSufficientBalance(MAX_ENTRY_KURUS * 2n, 9007199254740991n));
  assert.throws(() => policy.assertSufficientBalance(9007199254740990n, 9007199254740991n), { code: 'INSUFFICIENT_FUNDS' });
});
