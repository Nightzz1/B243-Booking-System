import { configureDatabaseRoles } from './database-roles.mjs';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const migrationsDirectory = path.join(rootDirectory, 'drizzle');
const connection = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST ?? 'localhost',
      port: Number(process.env.PGPORT ?? process.env.POSTGRES_PORT ?? 5432),
      database: process.env.PGDATABASE ?? process.env.POSTGRES_DB,
      user: process.env.PGUSER ?? process.env.POSTGRES_USER,
      password: process.env.PGPASSWORD ?? process.env.POSTGRES_PASSWORD,
    };
const pool = new Pool({
  ...connection,
  max: 1,
  connectionTimeoutMillis: 10_000,
  ssl:
    process.env.DB_SSL === 'true'
      ? {
          rejectUnauthorized:
            process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
        }
      : undefined,
});

let client;

try {
  client = await pool.connect();
  await client.query(
    "SELECT pg_advisory_lock(hashtext('drum-room-booking-migrations'))",
  );
  await client.query(`
    CREATE TABLE IF NOT EXISTS _app_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();

  for (const filename of filenames) {
    const sql = await readFile(
      path.join(migrationsDirectory, filename),
      'utf8',
    );
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = await client.query(
      'SELECT checksum FROM _app_migrations WHERE filename = $1',
      [filename],
    );

    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(
          `Migration ${filename} was modified after being applied.`,
        );
      }
      console.log(`Already applied: ${filename}`);
      continue;
    }

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO _app_migrations (filename, checksum) VALUES ($1, $2)',
        [filename, checksum],
      );
      await client.query('COMMIT');
      console.log(`Applied: ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  await configureDatabaseRoles(client);
} finally {
  if (client) {
    try {
      await client.query(
        "SELECT pg_advisory_unlock(hashtext('drum-room-booking-migrations'))",
      );
    } finally {
      client.release();
    }
  }
  await pool.end();
}
