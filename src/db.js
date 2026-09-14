import pg from 'pg';
import config from './config.js';
import { logger } from './logger.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: config.dbStatementTimeoutMs,
  idle_in_transaction_session_timeout: config.dbIdleTransactionTimeoutMs,
  application_name: 'lineoa-complaint-api',
  ssl: config.dbSsl
    ? { rejectUnauthorized: config.dbSslRejectUnauthorized }
    : false,
});

pool.on('error', (error) => {
  logger.error('postgres_pool_error', { error: error.message, stack: error.stack });
});

export async function checkDatabase() {
  const result = await pool.query(`
    SELECT
      current_timestamp AS now,
      current_setting('server_version') AS server_version,
      current_setting('server_version_num')::integer AS server_version_num
  `);
  const database = result.rows[0];
  const actualMajor = Math.floor(database.server_version_num / 10000);

  if (actualMajor !== config.postgresRequiredMajor) {
    throw new Error(
      `Unsupported PostgreSQL major version ${actualMajor}; expected ${config.postgresRequiredMajor}`,
    );
  }

  return {
    ...database,
    server_major: actualMajor,
  };
}
