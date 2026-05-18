/**
 * Boots a real Nest app for a test suite, gives back the supertest agent,
 * and exposes the underlying PrismaClient so tests can inspect persisted
 * state (audit_logs, notification_logs, refresh tokens, …).
 *
 * Each suite resets its own table state in `beforeEach` so suites are
 * independent.
 */
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import argon2 from 'argon2';
import { prisma, StaffRole, type PrismaClient } from '@skydrop/db';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';

export interface AppHarness {
  app: NestExpressApplication;
  prisma: PrismaClient;
  baseUrl: string;
  close(): Promise<void>;
}

export async function bootTestApp(): Promise<AppHarness> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    logger: false,
  });

  app.useLogger(app.get(Logger));
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({
    origin: ['http://localhost:3001', 'http://localhost:3002'],
    credentials: true,
  });

  await app.init();
  await app.listen(0); // any free port
  const server = app.getHttpServer();
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  return {
    app,
    prisma,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await app.close();
    },
  };
}

/**
 * Wipes the auth-related tables so each test starts from a clean slate
 * (seed reference data — notification_templates, system_settings, etc.
 * — is preserved). Catalog tables go first: products/variants/proposals
 * FK-restrict seller deletion, so a suite that created catalog rows
 * would otherwise block the next suite's seller.deleteMany regardless of
 * run order.
 */
export async function resetAuthState(prisma: PrismaClient): Promise<void> {
  // Order-critical chain (CLAUDE MUST #12): Module-7 call-center rows
  // (call_queue_entries/call_attempts FK orders; agent_call_settings FK
  // staff_users) → resetCallCenterState FIRST; then stock rows FK
  // orders/variants/sellers → inventory; then Module-6 order/customer
  // rows → resetOrderState; then catalog (FK sellers); then the
  // auth/seller wipe.
  await resetCallCenterState(prisma);
  await resetInventoryState(prisma);
  await resetOrderState(prisma);
  await resetCatalogState(prisma);
  await prisma.$transaction([
    prisma.notificationLog.deleteMany({}),
    prisma.auditLog.deleteMany({}),
    prisma.sellerApiKey.deleteMany({}),
    prisma.sellerEmailVerificationToken.deleteMany({}),
    prisma.sellerPasswordResetToken.deleteMany({}),
    prisma.sellerRefreshToken.deleteMany({}),
    prisma.sellerInvitation.deleteMany({}),
    // Module 2 — seller-side tables that FK-restrict seller deletion.
    prisma.sellerNote.deleteMany({}),
    prisma.sellerOnboardingProgress.deleteMany({}),
    prisma.sellerNotificationPreference.deleteMany({}),
    // Addresses are polymorphic (no FK at DB layer) — still wipe to keep
    // tests independent.
    prisma.address.deleteMany({}),
    prisma.staffEmailVerificationToken.deleteMany({}),
    prisma.staffPasswordResetToken.deleteMany({}),
    prisma.staffRefreshToken.deleteMany({}),
    prisma.seller.deleteMany({}),
    prisma.staffUser.deleteMany({}),
  ]);
}

/**
 * Wipes Module-4 catalog tables. Call BEFORE resetAuthState in catalog
 * suites: products/variants/proposals FK-restrict seller deletion, so
 * they must go first. TRUNCATE … CASCADE sidesteps the category
 * self-FK ordering problem (and only cascades into already-empty
 * downstream tables in Phase 1A).
 */
export async function resetCatalogState(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE ' +
      [
        'category_proposals',
        'category_attribute_definitions',
        'product_images',
        'product_variants',
        'products',
        'bulk_product_uploads',
        'seller_csv_mappings',
        'categories',
      ].join(', ') +
      ' RESTART IDENTITY CASCADE',
  );
}

/**
 * Wipes Module-5 inventory tables (+ the interim Layer-5 order/customer
 * tables a reservation FKs to — see Finding A; Module 6 will own those).
 * Must run BEFORE resetCatalogState (stock rows FK product_variants) and
 * BEFORE the seller wipe (stock rows FK sellers). TRUNCATE … CASCADE
 * handles ordering and works on the stock_movements hypertable. Seeded
 * `warehouses` (BLR-01, referenced by ops.default_warehouse_id) are
 * intentionally NOT truncated — only test-created zones/bins.
 */
export async function resetInventoryState(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE ' +
      [
        'stock_alert_state',
        'stock_adjustment_lines',
        'stock_movements',
        'stock_reservations',
        'stock_levels',
        'stock_batches',
        'stock_adjustments',
        'cycle_count_items',
        'cycle_counts',
        'goods_receipt_lines',
        'goods_receipts',
        // Test-created topology (seeded warehouses are preserved).
        'warehouse_bins',
        'warehouse_zones',
      ].join(', ') +
      ' RESTART IDENTITY CASCADE',
  );
}

/**
 * Wipes Module-6 order/customer tables. Module 6 now OWNS this cleanup
 * (the interim Order/OrderItem/Customer coupling has been removed from
 * resetInventoryState — CLAUDE MUST #12). Must run AFTER
 * resetInventoryState (stock_reservations/stock_movements FK orders) and
 * BEFORE resetCatalogState (order_items FK product_variants) + the seller
 * wipe (orders/customers FK sellers). TRUNCATE … CASCADE handles the
 * order_items/order_events/address-cache child ordering.
 */
export async function resetOrderState(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE ' +
      [
        'order_events',
        'order_recipient_address_cache',
        'order_items',
        'bulk_order_uploads',
        'orders',
        'customers',
      ].join(', ') +
      ' RESTART IDENTITY CASCADE',
  );
}

/**
 * Wipes Module-7 call-center tables (CLAUDE MUST #12). Chained BEFORE
 * resetOrderState because call_queue_entries / call_attempts FK orders
 * (CC-6 now enqueues on every PENDING_CONFIRMATION order created in
 * e2e); agent_call_settings FK staff_users. Explicit truncation rather
 * than relying on the orders-CASCADE so agent_call_settings is cleared
 * too. call_attempts is append-only in the app (CC-1) — TRUNCATE here
 * is test teardown, not an app mutation path.
 */
export async function resetCallCenterState(
  prisma: PrismaClient,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE ' +
      ['call_attempts', 'call_queue_entries', 'agent_call_settings'].join(
        ', ',
      ) +
      ' RESTART IDENTITY CASCADE',
  );
}

export async function createTestStaff(
  prisma: PrismaClient,
  overrides: Partial<{ email: string; password: string; role: StaffRole }> = {},
): Promise<{ id: string; email: string; role: StaffRole; password: string }> {
  const email = overrides.email ?? `staff-${Date.now()}-${Math.random()}@test.local`;
  const password = overrides.password ?? 'TestStaff-Password!42';
  const role = overrides.role ?? StaffRole.SUPER_ADMIN;
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const staff = await prisma.staffUser.create({
    data: { email: email.toLowerCase(), emailDisplay: email, passwordHash, role },
  });
  return { id: staff.id, email: staff.email, role, password };
}

/** Flushes the Redis logical DB (1) used for tests — clears rate-limit
 *  counters + BullMQ queues between suites. */
export async function flushTestRedis(): Promise<void> {
  const { default: IORedis } = await import('ioredis');
  const url = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379/1';
  const r = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: false });
  await r.flushdb();
  await r.quit();
}

/**
 * Poll until `predicate()` returns a truthy value. Used to wait for BullMQ
 * to drain an enqueued email job and write the notification_log row.
 */
export async function waitFor<T>(
  predicate: () => Promise<T | null | undefined>,
  opts: { timeoutMs?: number; intervalMs?: number; description?: string } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const intervalMs = opts.intervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  let last: T | null | undefined;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `waitFor timed out after ${timeoutMs}ms${opts.description ? ` (${opts.description})` : ''}`,
  );
}
