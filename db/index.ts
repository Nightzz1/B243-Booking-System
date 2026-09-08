import { Pool, type PoolConfig } from 'pg';

const globalForDatabase = globalThis as typeof globalThis & {
  bookingDatabasePool?: Pool;
};

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createPool() {
  const config: PoolConfig = {
    max: positiveInteger(process.env.DB_POOL_MAX, 10),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  };

  if (process.env.DATABASE_URL) {
    config.connectionString = process.env.DATABASE_URL;
  } else {
    config.host = process.env.PGHOST ?? 'localhost';
    config.port = positiveInteger(
      process.env.PGPORT ?? process.env.POSTGRES_PORT,
      5432,
    );
    config.database = process.env.PGDATABASE ?? process.env.POSTGRES_DB;
    config.user = process.env.PGUSER ?? process.env.POSTGRES_USER;
    config.password = process.env.PGPASSWORD ?? process.env.POSTGRES_PASSWORD;
  }

  if (process.env.DB_SSL === 'true') {
    config.ssl = {
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    };
  }

  const nextPool = new Pool(config);
  nextPool.on('error', (error) => {
    console.error('Unexpected idle PostgreSQL connection error', error);
  });
  return nextPool;
}

const pool = globalForDatabase.bookingDatabasePool ?? createPool();
globalForDatabase.bookingDatabasePool = pool;

export function getPool() {
  return pool;
}
