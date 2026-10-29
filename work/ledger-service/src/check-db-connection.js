import { checkDatabase, createDatabasePool } from './infrastructure/postgres/database.js';

let pool;
try {
  pool = createDatabasePool();
  const databaseName = await checkDatabase(pool);
  console.log(`Connected to PostgreSQL database "${databaseName}".`);
} catch (error) {
  console.error('PostgreSQL connection check failed; verify the Ledger configuration and server availability.');
  process.exitCode = 1;
} finally {
  if (pool) await pool.end();
}
