const { createDatabasePool } = require('./database');

async function main() {
  let pool;
  try {
    pool = createDatabasePool();
    const result = await pool.query(
      'SELECT current_database() AS database_name, current_user AS database_user',
    );
    const { database_name: databaseName, database_user: databaseUser } = result.rows[0];
    console.log(`Connected to PostgreSQL database "${databaseName}" as "${databaseUser}".`);
  } catch (error) {
    console.error(`PostgreSQL connection failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
}

main();
