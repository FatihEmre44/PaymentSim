import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresTransactionManager } from '../src/infrastructure/postgres/postgres-transaction-manager.js';
import { ReservationRepository } from '../src/infrastructure/postgres/reservation-repository.js';
import { createDatabasePool } from '../src/infrastructure/postgres/database.js';

function setup({ database = 'Ledger', failCommit = false, failRollback = false } = {}) {
  const commands = [];
  const releases = [];
  const client = {
    query: async sql => {
      commands.push(sql);
      if (sql === 'COMMIT' && failCommit) throw new Error('commit connection lost');
      if (sql === 'ROLLBACK' && failRollback) throw new Error('rollback connection lost');
      return { rows: [{ database_name: database }] };
    },
    release: error => releases.push(error),
  };
  return { commands, releases, manager: new PostgresTransactionManager({ connect: async () => client }) };
}

test('commits once and gives the application repositories rather than a pg client', async () => {
  const { manager, commands, releases } = setup();
  assert.equal(await manager.run(async context => {
    assert.equal(context.query, undefined);
    assert.equal(typeof context.reservations.findByPaymentId, 'function');
    return 'ok';
  }), 'ok');
  assert.deepEqual(commands, ['BEGIN ISOLATION LEVEL READ COMMITTED', 'SELECT current_database() AS database_name', 'COMMIT']);
  assert.deepEqual(releases, [undefined]);
});

test('rolls back on an operation error and preserves the original error', async () => {
  const { manager, commands, releases } = setup();
  const failure = new Error('write failed');
  await assert.rejects(manager.run(async () => { throw failure; }), error => error === failure);
  assert.equal(commands.at(-1), 'ROLLBACK');
  assert.deepEqual(releases, [undefined]);
});

test('discards a connection whose rollback fails', async () => {
  const { manager, releases } = setup({ failRollback: true });
  const failure = new Error('original error');
  await assert.rejects(manager.run(async () => { throw failure; }), error => error === failure);
  assert.match(releases[0].message, /rollback/);
});

test('does not replay an uncertain commit and discards the connection', async () => {
  const { manager, commands, releases } = setup({ failCommit: true });
  let invocations = 0;
  await assert.rejects(manager.run(async () => { invocations++; }), /commit connection lost/);
  assert.equal(invocations, 1);
  assert.equal(commands.at(-1), 'ROLLBACK');
  assert.match(releases[0].message, /commit/);
});

test('refuses the wrong database before invoking the application', async () => {
  const { manager, commands } = setup({ database: 'payment_db' });
  let called = false;
  await assert.rejects(manager.run(async () => { called = true; }), { code: 'DATABASE_MISMATCH' });
  assert.equal(called, false);
  assert.equal(commands.at(-1), 'ROLLBACK');
});

test('only the verified payment unique constraint maps to a reservation race', async () => {
  for (const constraint of ['reservations_payment_id_key', 'reservations_pkey', 'another_unique']) {
    const failure = Object.assign(new Error('unique violation'), { code: '23505', constraint });
    const repo = new ReservationRepository({ query: async () => { throw failure; } });
    await assert.rejects(repo.create({ amountKurus: 1n }), error =>
      constraint === 'reservations_payment_id_key' ? error.code === 'RESERVATION_ALREADY_EXISTS' : error === failure);
  }
});

test('rejects incorrect database URLs without exposing credentials', () => {
  for (const url of ['invalid', 'postgresql://user:secret@localhost/payment_db',
    'postgresql://user:secret@localhost/Ledger?database=payment_db', 'https://user:secret@localhost/Ledger']) {
    assert.throws(() => createDatabasePool(url), error => {
      assert.equal(error.message.includes('secret'), false);
      return ['DATABASE_MISMATCH', 'INVALID_INPUT'].includes(error.code);
    });
  }
});
