import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDatabase, createDatabasePool } from './infrastructure/postgres/database.js';
import { PostgresTransactionManager } from './infrastructure/postgres/postgres-transaction-manager.js';
import { ReserveFunds } from './application/reserve-funds.js';

export const pool = createDatabasePool();

const reserveFundsUseCase = new ReserveFunds({
  transactionManager: new PostgresTransactionManager(pool),
});

export const reserveFunds = (input) => reserveFundsUseCase.execute(input);
export const close = () => pool.end();

// This milestone is a callable use case, not a running Kafka/HTTP service.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await checkDatabase(pool);
    console.log('Ledger connection verified. Reservation API is available as an import; messaging is pending contract approval.');
  } catch {
    console.error('Ledger startup check failed; verify configuration and database availability.');
    process.exitCode = 1;
  } finally {
    await close();
  }
}
