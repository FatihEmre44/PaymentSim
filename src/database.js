require('dotenv').config();
const { Pool } = require('pg');

function createDatabasePool(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required. Copy .env.example to .env and set your payment database connection.');
  }

  return new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
  });
}

module.exports = { createDatabasePool };
