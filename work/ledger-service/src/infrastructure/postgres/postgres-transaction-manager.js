import { AccountRepository } from './account-repository.js';
import { JournalRepository } from './journal-repository.js';
import { ReservationRepository } from './reservation-repository.js';
import { errorCodes, LedgerError } from '../../domain/errors.js';

export function createRepositories(client) {
  return {
    accounts: new AccountRepository(client),
    reservations: new ReservationRepository(client),
    journals: new JournalRepository(client),
  };
}

export class PostgresTransactionManager {
  constructor(pool, { expectedDatabase = 'Ledger', repositories = createRepositories } = {}) {
    this.pool = pool;
    this.expectedDatabase = expectedDatabase;
    this.repositories = repositories;
  }

  async run(operation) {
    const client = await this.pool.connect();
    let begun = false;
    let committing = false;
    let discard;
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      begun = true;
      const { rows } = await client.query('SELECT current_database() AS database_name');
      if (rows[0].database_name !== this.expectedDatabase) {
        throw new LedgerError(errorCodes.DATABASE_MISMATCH, 'Connected database does not match the Ledger target');
      }
      const result = await operation(this.repositories(client));
      committing = true;
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (!begun || committing) discard = error;
      if (begun) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          discard = rollbackError;
        }
      }
      // Never automatically replay a transaction with an uncertain commit result.
      throw error;
    } finally {
      client.release(discard);
    }
  }
}
