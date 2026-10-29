import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { errorCodes, LedgerError } from '../../domain/errors.js';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

export function createDatabasePool(databaseUrl = process.env.DATABASE_URL) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new LedgerError(errorCodes.INVALID_INPUT, 'A valid DATABASE_URL for Ledger is required');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname !== '/Ledger' ||
      url.searchParams.has('database') || url.searchParams.has('dbname')) {
    throw new LedgerError(errorCodes.DATABASE_MISMATCH, 'DATABASE_URL must target the Ledger database');
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  pool.on('error', () => {
    // Do not print driver errors or connection URLs, which may contain secrets.
    console.error('Ledger PostgreSQL idle connection failed');
  });
  return pool;
}

export async function checkDatabase(pool) {
  const { rows } = await pool.query('SELECT current_database() AS database_name');
  if (rows[0].database_name !== 'Ledger') {
    throw new LedgerError(errorCodes.DATABASE_MISMATCH, 'Connected database must be Ledger');
  }
  return rows[0].database_name;
}
