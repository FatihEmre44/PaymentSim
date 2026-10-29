import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { ReserveFunds } from '../../src/application/reserve-funds.js';
import { PostgresTransactionManager, createRepositories } from '../../src/infrastructure/postgres/postgres-transaction-manager.js';

let pool;
let useCase;
const command = (companyId, amountKurus = 100) => ({ companyId, paymentId: randomUUID(), amountKurus, currency: 'TRY' });

before(async () => {
  const port = Number(process.env.LEDGER_TEST_PORT);
  const clusterDir = process.env.LEDGER_TEST_CLUSTER_DIR;
  if (!clusterDir || !Number.isInteger(port) || port <= 0 || port === 5432) {
    throw new Error('Run npm run test:integration; an isolated test cluster is required');
  }
  pool = new pg.Pool({ host: '127.0.0.1', port, user: 'ledger_test', database: 'ledger_test',
    max: 12, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  const { rows } = await pool.query('SHOW data_directory');
  assert.equal(realpathSync(resolve(rows[0].data_directory)), realpathSync(clusterDir));
  useCase = new ReserveFunds({ transactionManager: new PostgresTransactionManager(pool, { expectedDatabase: 'ledger_test' }) });
});
after(async () => { if (pool) await pool.end(); });

async function company(balance = 1000n, { omitReserved = false } = {}) {
  const companyId = randomUUID();
  const accounts = {};
  for (const type of ['AVAILABLE', 'RESERVED', 'SIMULATED_OUTGOING']) {
    if (omitReserved && type === 'RESERVED') continue;
    const { rows } = await pool.query(
      'INSERT INTO ledger_accounts (company_id, account_type) VALUES ($1,$2) RETURNING account_id', [companyId, type]);
    accounts[type] = rows[0].account_id;
  }
  if (balance > 0n) {
    // Synthetic, balanced opening state for tests only; not a demo funding policy.
    const { rows } = await pool.query(
      "INSERT INTO journal_transactions (company_id,entry_type) VALUES ($1,'DEMO_FUNDING') RETURNING journal_id", [companyId]);
    await pool.query('INSERT INTO ledger_entries (journal_id,account_id,amount_kurus) VALUES ($1,$2,$3),($1,$4,$5)',
      [rows[0].journal_id, accounts.AVAILABLE, balance.toString(), accounts.SIMULATED_OUTGOING, (-balance).toString()]);
  }
  return { companyId, accounts };
}

async function counts(paymentId) {
  const { rows } = await pool.query(`SELECT
    (SELECT count(*)::int FROM reservations WHERE payment_id=$1) AS reservations,
    (SELECT count(*)::int FROM journal_transactions WHERE payment_id=$1) AS journals,
    (SELECT count(*)::int FROM ledger_entries e JOIN journal_transactions j USING(journal_id) WHERE j.payment_id=$1) AS entries`, [paymentId]);
  return rows[0];
}
async function balance(accountId) {
  const { rows } = await pool.query('SELECT COALESCE(sum(amount_kurus),0)::text AS balance FROM ledger_entries WHERE account_id=$1', [accountId]);
  return BigInt(rows[0].balance);
}

test('successful reservation persists one balanced journal and exact balances', async () => {
  const c = await company();
  const input = command(c.companyId, 250);
  const result = await useCase.execute(input);
  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.amountKurus, '250');
  assert.deepEqual(await counts(input.paymentId), { reservations: 1, journals: 1, entries: 2 });
  assert.equal(await balance(c.accounts.AVAILABLE), 750n);
  assert.equal(await balance(c.accounts.RESERVED), 250n);
  const { rows } = await pool.query('SELECT sum(amount_kurus)::text AS total FROM ledger_entries WHERE journal_id=$1', [result.reserveJournalId]);
  assert.equal(rows[0].total, '0');
});

test('insufficient funds leaves no reservation, journal or entries', async () => {
  const c = await company(99n);
  const input = command(c.companyId, 100);
  await assert.rejects(useCase.execute(input), { code: 'INSUFFICIENT_FUNDS' });
  assert.deepEqual(await counts(input.paymentId), { reservations: 0, journals: 0, entries: 0 });
  assert.equal(await balance(c.accounts.AVAILABLE), 99n);
});

test('concurrent and subsequent duplicates all return one reservation', async () => {
  const c = await company();
  const input = command(c.companyId, 200);
  const results = await Promise.all(Array.from({ length: 8 }, () => useCase.execute(input)));
  assert.equal(new Set(results.map(r => r.reservationId)).size, 1);
  assert.deepEqual(await useCase.execute(input), results[0]);
  assert.deepEqual(await counts(input.paymentId), { reservations: 1, journals: 1, entries: 2 });
  assert.equal(await balance(c.accounts.AVAILABLE), 800n);
});

test('conflicting amount and company are rejected even when the other company has no account', async () => {
  const c = await company();
  const input = command(c.companyId);
  await useCase.execute(input);
  await assert.rejects(useCase.execute({ ...input, amountKurus: 101 }), { code: 'RESERVATION_CONFLICT' });
  await assert.rejects(useCase.execute({ ...input, companyId: randomUUID() }), { code: 'RESERVATION_CONFLICT' });
  assert.deepEqual(await counts(input.paymentId), { reservations: 1, journals: 1, entries: 2 });
});

test('concurrent distinct payments cannot overspend available funds', async () => {
  const c = await company(1000n);
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => useCase.execute(command(c.companyId, 300))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 3);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'INSUFFICIENT_FUNDS'));
  assert.equal(await balance(c.accounts.AVAILABLE), 100n);
  assert.equal(await balance(c.accounts.RESERVED), 900n);
});

test('cross-company payment collision rolls back the losing journal', async () => {
  const a = await company();
  const b = await company();
  let arrived = 0;
  let ready;
  const barrier = new Promise(resolve => { ready = resolve; });
  const manager = new PostgresTransactionManager(pool, { expectedDatabase: 'ledger_test', repositories: client => {
    const repos = createRepositories(client);
    const create = repos.reservations.create.bind(repos.reservations);
    repos.reservations.create = async input => {
      // Both transactions have written their own journal before either inserts the reservation.
      if (++arrived === 2) ready();
      await barrier;
      return create(input);
    };
    return repos;
  } });
  const racing = new ReserveFunds({ transactionManager: manager });
  const input = command(a.companyId, 100);
  const results = await Promise.allSettled([racing.execute(input), racing.execute({ ...input, companyId: b.companyId })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'RESERVATION_CONFLICT');
  assert.deepEqual(await counts(input.paymentId), { reservations: 1, journals: 1, entries: 2 });
  assert.equal(await balance(a.accounts.AVAILABLE) + await balance(b.accounts.AVAILABLE), 1900n);
});

test('failure after the first entry causes complete rollback', async () => {
  const c = await company();
  const input = command(c.companyId);
  const manager = new PostgresTransactionManager(pool, { expectedDatabase: 'ledger_test', repositories: client => {
    let entryWrites = 0;
    const failingClient = { query: async (sql, values) => {
      if (sql.includes('INSERT INTO public.ledger_entries') && ++entryWrites === 2) throw new Error('injected second-entry failure');
      return client.query(sql, values);
    } };
    return createRepositories(failingClient);
  } });
  await assert.rejects(new ReserveFunds({ transactionManager: manager }).execute(input), /injected second-entry failure/);
  assert.deepEqual(await counts(input.paymentId), { reservations: 0, journals: 0, entries: 0 });
  assert.equal(await balance(c.accounts.AVAILABLE), 1000n);
});

test('failure after inserting the reservation also rolls back the complete transaction', async () => {
  const c = await company();
  const input = command(c.companyId);
  const manager = new PostgresTransactionManager(pool, { expectedDatabase: 'ledger_test', repositories: client => {
    const repos = createRepositories(client);
    const create = repos.reservations.create.bind(repos.reservations);
    repos.reservations.create = async request => { await create(request); throw new Error('injected post-reservation failure'); };
    return repos;
  } });
  await assert.rejects(new ReserveFunds({ transactionManager: manager }).execute(input), /injected post-reservation failure/);
  assert.deepEqual(await counts(input.paymentId), { reservations: 0, journals: 0, entries: 0 });
  assert.equal(await balance(c.accounts.AVAILABLE), 1000n);
});

test('maximum safe public amount is persisted exactly', async () => {
  const c = await company(BigInt(Number.MAX_SAFE_INTEGER));
  const result = await useCase.execute(command(c.companyId, Number.MAX_SAFE_INTEGER));
  assert.equal(result.amountKurus, '9007199254740991');
  assert.equal(await balance(c.accounts.AVAILABLE), 0n);
  assert.equal(await balance(c.accounts.RESERVED), 9007199254740991n);
});

test('wrong database guard rejects before writing', async () => {
  const c = await company();
  const input = command(c.companyId);
  const productionGuard = new ReserveFunds({ transactionManager: new PostgresTransactionManager(pool) });
  await assert.rejects(productionGuard.execute(input), { code: 'DATABASE_MISMATCH' });
  assert.deepEqual(await counts(input.paymentId), { reservations: 0, journals: 0, entries: 0 });
});
