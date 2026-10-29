import assert from 'node:assert/strict';
import test from 'node:test';
import { ReserveFunds } from '../src/application/reserve-funds.js';

const input = { paymentId: '10000000-0000-0000-0000-000000000001',
  companyId: '20000000-0000-0000-0000-000000000002', amountKurus: 125000, currency: 'TRY' };
const existing = { ...input, amountKurus: '125000', status: 'ACTIVE', reservationId: 'reservation' };

function setup({ find = async () => null, balance = 500000n, missing = null, createError = null } = {}) {
  const calls = [];
  const useCase = new ReserveFunds({ transactionManager: { run: async operation => {
    calls.push('transaction');
    return operation({
      accounts: {
        lockAccount: async (companyId, accountType) => {
          calls.push(`lock:${accountType}`);
          return accountType === missing ? null : { accountId: accountType, companyId, accountType, currency: 'TRY' };
        },
        getBalance: async () => { calls.push('balance'); return balance; },
      },
      reservations: {
        findByPaymentId: async () => { calls.push('find'); return find(); },
        create: async request => {
          calls.push('create');
          if (createError) throw createError;
          return { ...request, amountKurus: request.amountKurus.toString(), status: 'ACTIVE' };
        },
      },
      journals: { record: async journal => {
        calls.push('journal');
        assert.equal(journal.entries.reduce((sum, e) => sum + e.amountKurus, 0n), 0n);
        return 'journal';
      } },
    });
  } } });
  return { useCase, calls };
}

test('locks accounts and checks balance before writing a balanced reservation', async () => {
  const { useCase, calls } = setup();
  const result = await useCase.execute(input);
  assert.equal(result.amountKurus, '125000');
  assert.equal(result.reserveJournalId, 'journal');
  assert.deepEqual(calls, ['transaction', 'find', 'lock:AVAILABLE', 'find', 'lock:RESERVED', 'balance', 'journal', 'create']);
});

test('returns a matching reservation without account lookup or new journal', async () => {
  const { useCase, calls } = setup({ find: async () => existing, missing: 'AVAILABLE' });
  assert.equal(await useCase.execute(input), existing);
  assert.deepEqual(calls, ['transaction', 'find']);
});

test('detects conflicting company or amount before account lookup', async () => {
  for (const changed of [{ amountKurus: 1 }, { companyId: '30000000-0000-0000-0000-000000000003' }]) {
    const { useCase, calls } = setup({ find: async () => existing, missing: 'AVAILABLE' });
    await assert.rejects(useCase.execute({ ...input, ...changed }), { code: 'RESERVATION_CONFLICT' });
    assert.deepEqual(calls, ['transaction', 'find']);
  }
});

test('rechecks the reservation after waiting on the company lock', async () => {
  let reads = 0;
  const { useCase, calls } = setup({ find: async () => ++reads === 1 ? null : existing });
  assert.equal(await useCase.execute(input), existing);
  assert.deepEqual(calls, ['transaction', 'find', 'lock:AVAILABLE', 'find']);
});

test('insufficient balance leaves no accounting writes', async () => {
  const { useCase, calls } = setup({ balance: 124999n });
  await assert.rejects(useCase.execute(input), { code: 'INSUFFICIENT_FUNDS' });
  assert.equal(calls.includes('journal'), false);
  assert.equal(calls.includes('create'), false);
});

test('missing accounts fail before any accounting write', async () => {
  for (const missing of ['AVAILABLE', 'RESERVED']) {
    const { useCase, calls } = setup({ missing });
    await assert.rejects(useCase.execute(input), { code: 'ACCOUNT_NOT_FOUND' });
    assert.equal(calls.includes('journal'), false);
  }
});

test('resolves a payment unique race in a new read transaction without rewriting', async () => {
  let reads = 0;
  const { useCase, calls } = setup({ find: async () => ++reads <= 2 ? null : existing,
    createError: Object.assign(new Error('race'), { code: 'RESERVATION_ALREADY_EXISTS' }) });
  assert.equal(await useCase.execute(input), existing);
  assert.deepEqual(calls.slice(-3), ['create', 'transaction', 'find']);
  assert.equal(calls.filter(c => c === 'journal').length, 1);
});

test('a cross-company payment race reports a business conflict', async () => {
  let reads = 0;
  const { useCase } = setup({ find: async () => ++reads <= 2 ? null : { ...existing, companyId: 'other' },
    createError: Object.assign(new Error('race'), { code: 'RESERVATION_ALREADY_EXISTS' }) });
  await assert.rejects(useCase.execute(input), { code: 'RESERVATION_CONFLICT' });
});

test('does not retry technical errors automatically', async () => {
  const failure = Object.assign(new Error('connection lost'), { code: '08006' });
  const { useCase, calls } = setup({ createError: failure });
  await assert.rejects(useCase.execute(input), error => error === failure);
  assert.equal(calls.filter(c => c === 'transaction').length, 1);
});

test('rejects invalid inputs before opening a transaction', async () => {
  const { useCase, calls } = setup();
  await assert.rejects(useCase.execute({ ...input, amountKurus: 0 }), { code: 'INVALID_INPUT' });
  assert.deepEqual(calls, []);
});
