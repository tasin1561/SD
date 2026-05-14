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
 * — is preserved).
 */
export async function resetAuthState(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction([
    prisma.notificationLog.deleteMany({}),
    prisma.auditLog.deleteMany({}),
    prisma.sellerApiKey.deleteMany({}),
    prisma.sellerEmailVerificationToken.deleteMany({}),
    prisma.sellerPasswordResetToken.deleteMany({}),
    prisma.sellerRefreshToken.deleteMany({}),
    prisma.sellerInvitation.deleteMany({}),
    prisma.staffEmailVerificationToken.deleteMany({}),
    prisma.staffPasswordResetToken.deleteMany({}),
    prisma.staffRefreshToken.deleteMany({}),
    prisma.seller.deleteMany({}),
    prisma.staffUser.deleteMany({}),
  ]);
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
