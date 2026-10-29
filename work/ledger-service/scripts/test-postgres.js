import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import pg from 'pg';

// Never uses DATABASE_URL or the user's running PostgreSQL instance.
const serviceRoot = fileURLToPath(new URL('../', import.meta.url));
const pgBin = process.env.PG_BIN;
const executable = name => pgBin ? join(pgBin, name + (process.platform === 'win32' ? '.exe' : '')) : name;
const runtimeRoot = join(serviceRoot, '.test-runtime');
mkdirSync(runtimeRoot, { recursive: true });
const runRoot = mkdtempSync(join(runtimeRoot, 'postgres-'));
const dataDir = join(runRoot, 'data');
const logPath = join(runRoot, 'postgres.log');
const database = 'ledger_test';
let admin;
let testPool;
let startAttempted = false;

function command(name, args, options = {}) {
  const result = spawnSync(executable(name), args, {
    encoding: 'utf8', windowsHide: true, timeout: 60000,
    // A background postgres child can inherit pipes on Windows, keeping spawnSync
    // waiting even after pg_ctl exits. Server diagnostics go to postgres.log.
    ...(name === 'pg_ctl' ? { stdio: 'ignore' } : {}), ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${name} failed (${result.error?.code ?? result.status}). Check PG_BIN and ${logPath}. ${result.stderr ?? ''}`);
  }
}

function stop() {
  if (!startAttempted) return;
  const result = spawnSync(executable('pg_ctl'), ['-D', dataDir, '-m', 'fast', '-w', '-t', '15', 'stop'], {
    encoding: 'utf8', windowsHide: true, timeout: 20000, stdio: 'ignore',
  });
  if (result.status !== 0 && existsSync(join(dataDir, 'postmaster.pid'))) {
    console.error(`Could not confirm test PostgreSQL shutdown. Data directory: ${dataDir}`);
    process.exitCode = 1;
  }
}

try {
  command('initdb', ['-D', dataDir, '-U', 'ledger_test', '--auth=trust', '--encoding=UTF8', '--no-locale']);
  const socket = createServer();
  await new Promise((res, rej) => { socket.once('error', rej); socket.listen(0, '127.0.0.1', res); });
  const port = socket.address().port;
  await new Promise(res => socket.close(res));
  startAttempted = true;
  command('pg_ctl', ['-D', dataDir, '-l', logPath, '-o', `-h 127.0.0.1 -p ${port}`, '-w', '-t', '30', 'start']);
  const config = { host: '127.0.0.1', port, user: 'ledger_test', database: 'postgres', connectionTimeoutMillis: 5000 };
  admin = new pg.Client(config);
  await admin.connect();
  const { rows } = await admin.query('SHOW data_directory');
  if (realpathSync(resolve(rows[0].data_directory)) !== realpathSync(dataDir)) {
    throw new Error('Refusing to modify a PostgreSQL server outside the isolated test directory');
  }
  await admin.query('CREATE DATABASE ledger_test');
  testPool = new pg.Pool({ ...config, database });
  await testPool.query(readFileSync(new URL('../test/fixtures/ledger-schema.sql', import.meta.url), 'utf8'));
  await testPool.end();
  testPool = undefined;
  await admin.end();
  admin = undefined;
  console.log(`Running PostgreSQL integration tests in an isolated cluster on port ${port}.`);
  const result = spawnSync(process.execPath, ['--test', '--test-timeout=30000', 'test/integration/reservations.test.js'], {
    cwd: serviceRoot, stdio: 'inherit', windowsHide: true, timeout: 60000,
    env: { ...process.env, LEDGER_TEST_PORT: String(port), LEDGER_TEST_CLUSTER_DIR: dataDir },
  });
  process.exitCode = result.status === 0 ? 0 : 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (testPool) await testPool.end();
  if (admin) await admin.end();
  stop();
  console.log(`Isolated test files retained at ${runRoot}`);
}
