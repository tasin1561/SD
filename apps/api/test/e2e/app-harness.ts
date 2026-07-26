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
import { NotificationListener } from '../../src/modules/notifications/services/notification-listener.service';

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
    // Module 10 (TRK-1) — mirrors main.ts so the public tracking
    // webhook controller can verify the HMAC over the EXACT bytes the
    // courier signed (re-serializing the parsed JSON would change
    // whitespace and break the signature). E2E specs that send a
    // signed webhook depend on this.
    rawBody: true,
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
 * M11 follow-up: quiesce any in-flight NotificationListener work
 * BEFORE the harness starts wiping tables. The lifecycle emit is
 * fire-and-forget (NOTIF-1 best-effort); within a single test suite
 * the app stays up across tests, and a leaked handle() from the
 * previous test can be mid-INSERT on notification_logs (which holds
 * FK RowShareLocks on orders/shipments) at the exact moment the next
 * test's beforeEach issues a TRUNCATE … CASCADE (AccessExclusiveLock).
 * Postgres detects the lock-cycle and aborts the TRUNCATE — surfaced
 * as the `40P01 deadlock detected` errors against
 * `resetWarehouseState`. Calling listener.drainInFlight() first
 * serialises the listener's writes before the truncate; for suites
 * that pass a harness this is automatic, callers that pass only
 * prisma (legacy) get the old behavior. Safe + no-op when the app
 * has no NotificationListener provider (it is universally registered
 * via AppModule → NotificationsModule, so this is always available
 * in e2e).
 */
export async function drainNotificationListener(
  app: NestExpressApplication,
): Promise<void> {
  const listener = app.get(NotificationListener, { strict: false });
  await listener.drainInFlight();
}

/**
 * Wipes the auth-related tables so each test starts from a clean slate
 * (seed reference data — notification_templates, system_settings, etc.
 * — is preserved). Catalog tables go first: products/variants/proposals
 * FK-restrict seller deletion, so a suite that created catalog rows
 * would otherwise block the next suite's seller.deleteMany regardless of
 * run order.
 *
 * When the `app` argument is supplied, the harness first drains any
 * in-flight NotificationListener work (M11 follow-up — see
 * `drainNotificationListener` docs). All e2e specs that exercise an
 * order lifecycle transition SHOULD pass the app; specs that don't
 * touch orders can still call the legacy single-arg form.
 */
export async function resetAuthState(
  prisma: PrismaClient,
  app?: NestExpressApplication,
): Promise<void> {
  if (app) await drainNotificationListener(app);
  // Order-critical chain (CLAUDE MUST #12): Module-8 warehouse rows
  // (shipment_items FK stock_batches/warehouse_bins; shipments FK
  // orders/staff_users; manifests FK staff_users) → resetWarehouseState
  // FIRST; then Module-7 call-center rows (call_queue_entries/
  // call_attempts FK orders; agent_call_settings FK staff_users) →
  // resetCallCenterState; then stock rows FK orders/variants/sellers →
  // inventory; then Module-6 order/customer rows → resetOrderState;
  // then catalog (FK sellers); then the auth/seller wipe.
  // Phase-1B + revised-plan (R0-R6) tables FIRST: several of them
  // FK-RESTRICT `orders` (pending_accruals, invoices) and `sellers`
  // (seller_users, wallet, remittances, settings overrides, courier
  // links, withdrawal requests), so they must be gone before
  // resetOrderState's orders truncate and before the seller wipe below.
  await resetPhase1bState(prisma);
  await resetWarehouseState(prisma);
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
 * Wipes the Phase-1B + revised-plan (R0-R6) tables that FK-RESTRICT
 * `sellers` or `orders` (CLAUDE MUST #12).
 *
 * This helper is why the e2e suite runs at all: `seller_users` landed
 * with seller-team RBAC and was never added to the reset chain, so
 * `prisma.seller.deleteMany()` had been failing with a 23001 RESTRICT
 * violation on EVERY suite. The gap survived because CI never invoked
 * `test:e2e` — nothing was watching. Four more tables
 * (seller_setting_overrides, seller_courier_account_links,
 * withdrawal_requests, pending_accruals) were added on top of it during
 * the R0-R2b work and inherited the same omission.
 *
 * TRUNCATE … CASCADE (same pattern as resetCatalogState) sidesteps the
 * intra-group FK ordering entirely — withdrawal_requests→remittances,
 * seller_wallet_entries→remittances, seller_user_invitations→
 * seller_users — instead of hand-sequencing a dozen deleteMany calls
 * whose correct order is easy to get subtly wrong.
 *
 * When you add ANY new table with a RESTRICT FK to `sellers`/`orders`,
 * add it here. To find omissions, query the DB for
 * `delete_rule NOT IN ('CASCADE','SET NULL')` FKs referencing sellers
 * and diff against this list.
 */
export async function resetPhase1bState(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE ' +
      [
        // R3 inbound freight bills — FK-RESTRICT sellers + goods_receipts
        // + seller_wallet_entries, so they must go before all three.
        'inbound_freight_charges',
        // R5 early-reservation reviews — FK-RESTRICT orders + sellers.
        'early_reservation_reviews',
        // R7 tickets — FK-RESTRICT sellers; ticket_events cascades.
        'ticket_events',
        'tickets',
        // Wallet + payouts (M21-M24)
        'withdrawal_requests',
        'pending_accruals',
        'seller_wallet_entries',
        'seller_wallet_balances',
        'remittances',
        // GST invoices (M25)
        'invoices',
        // Seller-team RBAC
        'seller_user_invitations',
        'seller_users',
        // Pricing + integrations
        'seller_pricing',
        'seller_webhook_endpoints',
        // Revised-plan R0/R1
        'seller_setting_overrides',
        'seller_courier_account_links',
      ].join(', ') +
      ' RESTART IDENTITY CASCADE',
  );
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
        // R4 serialized units — FK-RESTRICT sellers/variants/warehouses;
        // stock_unit_events cascades off stock_units, but truncating both
        // explicitly keeps the intent readable (MUST #12).
        'stock_unit_events',
        'stock_units',
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

/**
 * Wipes Module-8 warehouse tables. Chained FIRST in the reset cascade —
 * BEFORE resetCallCenterState (the call-center tables are independent
 * but the cascade order documents intent) and BEFORE resetInventoryState
 * (shipment_items.pickedBatchId/pickedBinId FK stock_batches/
 * warehouse_bins; deleting stock_batches before shipment_items would
 * blow the FK). Also BEFORE resetOrderState (order_shipments junction
 * FK orders) and BEFORE the staff wipe (shipments.pickStartedByStaffId/
 * packedByStaffId and manifests.closedByStaffId FK staff_users with
 * SET NULL). CASCADE handles the awb_labels/order_shipments/
 * shipment_items child ordering.
 *
 * Module 10 (F9): courier_webhooks + tracking_events + delivery_attempts
 * are TRUNCATED EXPLICITLY in the same statement, BEFORE shipments.
 *   - courier_webhooks.shipment_id is a NULLABLE FK with default
 *     onDelete=SetNull — a `TRUNCATE shipments CASCADE` would leave
 *     courier_webhooks rows behind with NULL shipment_id, leaking
 *     state across suites. Explicit truncation here is the F9 fix.
 *   - tracking_events (CASCADE on shipment delete) is a TimescaleDB
 *     hypertable; explicit truncation is consistent with how
 *     `stock_movements` (also a hypertable) is handled in
 *     resetInventoryState — works fine and is auditable.
 *   - delivery_attempts (CASCADE on shipment delete) is explicit for
 *     the same auditability reason.
 * The single TRUNCATE … CASCADE statement handles cross-table FK
 * cascading; the order of the table list is documentary.
 */
export async function resetWarehouseState(
  prisma: PrismaClient,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE ' +
      [
        // Module 10 (F9) — must precede shipments because courier_webhooks
        // is SET NULL (not CASCADE) on shipment delete.
        'courier_webhooks',
        'tracking_events',
        'delivery_attempts',
        'shipment_items',
        'awb_labels',
        'order_shipments',
        'shipments',
        'manifests',
      ].join(', ') +
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
