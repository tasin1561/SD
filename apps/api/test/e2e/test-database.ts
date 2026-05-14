/**
 * Test-DB helpers — creates and drops a dedicated `skydrop_test` database on
 * the same Postgres instance as dev. Migrations + seed run via prisma CLI
 * against an overridden DATABASE_URL.
 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';

const PG_HOST = process.env['TEST_DB_HOST'] ?? '127.0.0.1';
const PG_PORT = process.env['TEST_DB_PORT'] ?? '5432';
const PG_USER = process.env['TEST_DB_USER'] ?? 'skydrop';
const PG_PASSWORD = process.env['TEST_DB_PASSWORD'] ?? 'skydrop';
const TEST_DB = process.env['TEST_DB_NAME'] ?? 'skydrop_test';
const ADMIN_DB = process.env['TEST_DB_ADMIN'] ?? 'postgres';

export const TEST_DATABASE_URL = `postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${TEST_DB}?schema=public`;

const DB_PACKAGE_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'db');

function psqlExec(sql: string, db = ADMIN_DB): void {
  execSync(
    `docker exec -e PGPASSWORD=${PG_PASSWORD} skydrop-postgres psql -U ${PG_USER} -d ${db} -c "${sql}"`,
    { stdio: 'pipe' },
  );
}

export function createTestDatabase(): void {
  // Drop existing (terminate connections first).
  try {
    psqlExec(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB}' AND pid <> pg_backend_pid()`,
    );
  } catch {
    /* ignore — DB may not exist */
  }
  try {
    psqlExec(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  } catch {
    /* ignore */
  }
  psqlExec(`CREATE DATABASE ${TEST_DB}`);
}

export function dropTestDatabase(): void {
  try {
    psqlExec(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB}' AND pid <> pg_backend_pid()`,
    );
    psqlExec(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  } catch {
    /* best effort */
  }
}

export function runMigrations(): void {
  execSync('pnpm prisma migrate deploy', {
    cwd: DB_PACKAGE_DIR,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}

export function runSeed(): void {
  execSync('pnpm tsx prisma/seed.ts', {
    cwd: DB_PACKAGE_DIR,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
