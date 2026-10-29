const express = require('express');
const { createDatabasePool } = require('./database');

const app = express();
const port = process.env.PORT || 3000;
const databasePool = createDatabasePool();

app.locals.databasePool = databasePool;

app.use(express.json());


app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/health/db', async (req, res) => {
  try {
    await databasePool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

app.listen(port, () => {
  console.log(`Payment simulation server listening on port ${port}`);
});
