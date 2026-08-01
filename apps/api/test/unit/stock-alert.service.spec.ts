import { VariantStatus } from '@skydrop/db';
import { StockAlertService } from '../../src/modules/inventory-shared/stock-alert.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { EnvService } from '../../src/config/env.service';
import type { StockAvailabilityService } from '../../src/modules/inventory-shared/stock-availability.service';
import type { CatalogReadService } from '../../src/modules/catalog-read/services/catalog-read.service';
import type { EmailQueue } from '../../src/modules/email/queue/email.queue';

const NOW = new Date('2026-05-16T12:00:00.000Z');
const hoursAgo = (h: number): Date => new Date(NOW.getTime() - h * 3_600_000);

function makeSut(opts: {
  variantThreshold?: number | null;
  sellerDefault?: number | null;
  qtyAvailable: number;
  state?: { wasAlertActive: boolean; lowStockAlertSentAt: Date | null } | null;
  cooldownHours?: number;
  foreignVariant?: boolean;
}) {
  const upsert = jest.fn(
    async (_args: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({}),
  );
  const client = {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(client),
    seller: {
      findUnique: jest.fn(async () =>
        opts.foreignVariant
          ? {
              id: 's1',
              email: 'a@b.c',
              companyName: 'Acme',
              defaultLowStockThreshold: opts.sellerDefault ?? null,
            }
          : {
              id: 's1',
              email: 'a@b.c',
              companyName: 'Acme',
              defaultLowStockThreshold: opts.sellerDefault ?? null,
            },
      ),
    },
    stockAlertState: {
      findUnique: jest.fn(async () => opts.state ?? null),
      upsert,
    },
    systemSetting: {
      findUnique: jest.fn(async () => ({ valueInt: opts.cooldownHours ?? 24 })),
    },
    warehouse: { findUnique: jest.fn(async () => ({ name: 'BLR-01' })) },
  };
  const prisma = { client } as unknown as PrismaService;
  const env = { sellerAppUrl: 'http://app' } as unknown as EnvService;
  const availability = {
    compute: jest.fn(async () => opts.qtyAvailable),
  } as unknown as StockAvailabilityService;
  const catalog = {
    getVariantById: jest.fn(async () =>
      opts.foreignVariant
        ? {
            variantId: 'v1',
            sellerId: 'OTHER',
            skuCode: 'SKU',
            variantLabel: null,
            productId: 'p1',
            status: VariantStatus.ACTIVE,
            lowStockThreshold: opts.variantThreshold ?? null,
          }
        : {
            variantId: 'v1',
            sellerId: 's1',
            skuCode: 'SKU',
            variantLabel: null,
            productId: 'p1',
            status: VariantStatus.ACTIVE,
            lowStockThreshold: opts.variantThreshold ?? null,
          },
    ),
  } as unknown as CatalogReadService;
  const enqueue = jest.fn(async () => 'job1');
  const email = { enqueue } as unknown as EmailQueue;

  const svc = new StockAlertService(prisma, env, availability, catalog, email);
  return { svc, upsert, enqueue };
}

describe('StockAlertService — INV-9 state machine', () => {
  it('inactive + below + no prior send => FIRE (email + state active + sentAt set)', async () => {
    const { svc, upsert, enqueue } = makeSut({
      variantThreshold: 10,
      qtyAvailable: 4,
      state: null,
    });
    const r = await svc.evaluate('s1', 'v1', 'w1', NOW);
    expect(r.outcome).toBe('FIRED');
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0]?.[0].create).toMatchObject({
      wasAlertActive: true,
      lowStockAlertSentAt: NOW,
    });
  });

  it('active + still below => ALREADY_ACTIVE (no second email)', async () => {
    const { svc, enqueue, upsert } = makeSut({
      variantThreshold: 10,
      qtyAvailable: 3,
      state: { wasAlertActive: true, lowStockAlertSentAt: hoursAgo(1) },
    });
    const r = await svc.evaluate('s1', 'v1', 'w1', NOW);
    expect(r.outcome).toBe('ALREADY_ACTIVE');
    expect(enqueue).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled(); // no state change
  });

  it('active + recovered => CLEAR (wasAlertActive=false, no email, sentAt kept)', async () => {
    const { svc, enqueue, upsert } = makeSut({
      variantThreshold: 10,
      qtyAvailable: 25,
      state: { wasAlertActive: true, lowStockAlertSentAt: hoursAgo(2) },
    });
    const r = await svc.evaluate('s1', 'v1', 'w1', NOW);
    expect(r.outcome).toBe('CLEARED');
    expect(r.wasAlertActive).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    expect(upsert.mock.calls[0]?.[0].update).toMatchObject({
      wasAlertActive: false,
      lowStockAlertSentAt: hoursAgo(2),
    });
  });

  it('inactive + above => NOOP (no write when no row exists)', async () => {
    const { svc, enqueue, upsert } = makeSut({
      variantThreshold: 10,
      qtyAvailable: 99,
      state: null,
    });
    const r = await svc.evaluate('s1', 'v1', 'w1', NOW);
    expect(r.outcome).toBe('NOOP');
    expect(enqueue).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('cooldown guard: inactive + below but within cooldown => SUPPRESSED (active, no email)', async () => {
    const { svc, enqueue, upsert } = makeSut({
      variantThreshold: 10,
      qtyAvailable: 2,
      cooldownHours: 24,
      state: { wasAlertActive: false, lowStockAlertSentAt: hoursAgo(5) }, // 5h < 24h
    });
    const r = await svc.evaluate('s1', 'v1', 'w1', NOW);
    expect(r.outcome).toBe('SUPPRESSED_COOLDOWN');
    expect(enqueue).not.toHaveBeenCalled();
    expect(upsert.mock.calls[0]?.[0].update).toMatchObject({
      wasAlertActive: true,
      lowStockAlertSentAt: hoursAgo(5), // unchanged
    });
  });

  it('cooldown expired: inactive + below, last send older than cooldown => FIRE again', async () => {
    const { svc, enqueue, upsert } = makeSut({
      variantThreshold: 10,
      qtyAvailable: 2,
      cooldownHours: 24,
      state: { wasAlertActive: false, lowStockAlertSentAt: hoursAgo(30) }, // 30h > 24h
    });
    const r = await svc.evaluate('s1', 'v1', 'w1', NOW);
    expect(r.outcome).toBe('FIRED');
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0]?.[0].update).toMatchObject({
      wasAlertActive: true,
      lowStockAlertSentAt: NOW,
    });
  });

  it('variant override threshold beats seller default', async () => {
    const { svc } = makeSut({
      variantThreshold: 3,
      sellerDefault: 100,
      qtyAvailable: 5, // above 3, below 100
      state: null,
    });
    const r = await svc.evaluate('s1', 'v1', 'w1', NOW);
    expect(r.threshold).toBe(3);
    expect(r.outcome).toBe('NOOP');
  });

  it('no threshold configured => SKIPPED_NO_THRESHOLD', async () => {
    const { svc, enqueue } = makeSut({
      variantThreshold: null,
      sellerDefault: null,
      qtyAvailable: 0,
      state: null,
    });
    const r = await svc.evaluate('s1', 'v1', 'w1', NOW);
    expect(r.outcome).toBe('SKIPPED_NO_THRESHOLD');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('variant not owned by seller => SKIPPED_UNKNOWN_VARIANT', async () => {
    const { svc, enqueue } = makeSut({
      variantThreshold: 10,
      qtyAvailable: 0,
      foreignVariant: true,
    });
    const r = await svc.evaluate('s1', 'v1', 'w1', NOW);
    expect(r.outcome).toBe('SKIPPED_UNKNOWN_VARIANT');
    expect(enqueue).not.toHaveBeenCalled();
  });
});
