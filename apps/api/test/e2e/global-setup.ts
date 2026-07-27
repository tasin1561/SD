import { createTestDatabase, runMigrations, runSeed, TEST_DATABASE_URL } from './test-database';

export default async function globalSetup(): Promise<void> {
  // Hoist DATABASE_URL so subsequent jest workers + the Nest app all use the
  // test DB. Note: setting it AFTER the Prisma client has been imported would
  // be too late — workers re-import per-file, which is why we point them at
  // a single Redis logical DB above as well.
  process.env['DATABASE_URL'] = TEST_DATABASE_URL;
  process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379/1';
  process.env['NODE_ENV'] = 'test';
  // Force dev-mode email so we never hit Resend.
  process.env['RESEND_API_KEY'] = '';
  process.env['JWT_SIGNING_KEY'] =
    process.env['JWT_SIGNING_KEY'] ?? 'test-signing-key-please-rotate-aaaaaaaaaaaaaaaa';
  process.env['SELLER_APP_URL'] = process.env['SELLER_APP_URL'] ?? 'http://localhost:3001';
  process.env['ADMIN_APP_URL'] = process.env['ADMIN_APP_URL'] ?? 'http://localhost:3002';
  // Module 10 (TRK-1) — HMAC secret for inbound Delhivery webhooks. The
  // env var name is the value of the `tracking.webhook_secret_ref`
  // system_setting (seeded `TRACKING_WEBHOOK_SECRET_DELHIVERY`). e2e
  // tests sign request bodies with this exact secret; an unset value
  // would 401 every webhook.
  process.env['TRACKING_WEBHOOK_SECRET_DELHIVERY'] =
    process.env['TRACKING_WEBHOOK_SECRET_DELHIVERY'] ?? 'test-tracking-webhook-secret-delhivery';

  // eslint-disable-next-line no-console
  console.log(`[e2e] preparing test DB at ${TEST_DATABASE_URL}`);
  createTestDatabase();
  runMigrations();
  runSeed();
}
