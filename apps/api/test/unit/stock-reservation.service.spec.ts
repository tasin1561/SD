import { ActorType, ReservationReleaseReason, ReservationStatus } from '@skydrop/db';
import {
  InsufficientStockError,
  StockReservationService,
} from '../../src/modules/inventory-stock/services/stock-reservation.service';
import { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { StockReadService } from '../../src/modules/inventory-stock/services/stock-read.service';

const NOW = new Date('2026-05-16T12:00:00.000Z');

function makeSut(opts: {
  available?: number;
  sellerTtlOverride?: number | null;
  settingTtl?: number | null;
  reservation?: Record<string, unknown> | null;
} = {}) {
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  const levelUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];

  const client = {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(client),
    stockReservation: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return { id: 'r1', ...args.data };
      }),
      findUnique: jest.fn(async () => opts.reservation ?? null),
      update: jest.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
        updated.push(args);
        return {};
      }),
    },
    stockLevel: {
      updateMany: jest.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        levelUpdates.push(args);
        return { count: 1 };
      }),
    },
    seller: {
      findUnique: jest.fn(async () => ({
        reservationTtlHoursOverride: opts.sellerTtlOverride ?? null,
      })),
    },
    systemSetting: {
      findUnique: jest.fn(async () => ({ valueInt: opts.settingTtl ?? 48 })),
    },
    auditLog: { create: jest.fn(async () => ({ id: 'a1' })) },
  };
  const prisma = { client } as unknown as PrismaService;
  const audit = new AuditLogService(prisma);
  const stockRead = {
    getVariantStockLive: jest.fn(async () => ({
      sellerId: 's1',
      variantId: 'v1',
      warehouseId: 'w1',
      qtyOnHand: opts.available ?? 0,
      qtyReservedActive: 0,
      qtyAvailable: opts.available ?? 0,
    })),
  } as unknown as StockReadService;

  const svc = new StockReservationService(prisma, audit, stockRead);
  return { svc, created, updated, levelUpdates, client };
}

const reserveInput = (qty: number) => ({
  sellerId: 's1',
  variantId: 'v1',
  warehouseId: 'w1',
  qtyToReserve: qty,
  orderId: 'o1',
  orderItemId: 'oi1',
  now: NOW,
});

describe('StockReservationService.reserve (phase-1)', () => {
  it('rejects qty > available with InsufficientStockError', async () => {
    const { svc, created } = makeSut({ available: 3 });
    await expect(svc.reserve(reserveInput(5))).rejects.toBeInstanceOf(InsufficientStockError);
    expect(created).toHaveLength(0);
  });

  it('creates a phase-1 reservation (NULL bin/batch, ACTIVE) when qty <= available', async () => {
    const { svc, created } = makeSut({ available: 10, settingTtl: 48 });
    const r = await svc.reserve(reserveInput(7));
    expect(r.status).toBe(ReservationStatus.ACTIVE);
    expect(created[0]).toMatchObject({
      binId: null,
      batchId: null,
      qtyReserved: 7,
      status: ReservationStatus.ACTIVE,
      orderId: 'o1',
      orderItemId: 'oi1',
    });
    // expiresAt = now + 48h (system setting path)
    expect((created[0]?.expiresAt as Date).toISOString()).toBe(
      new Date(NOW.getTime() + 48 * 3_600_000).toISOString(),
    );
  });

  it('rejects a non-positive / non-integer qty', async () => {
    const { svc } = makeSut({ available: 10 });
    await expect(svc.reserve(reserveInput(0))).rejects.toMatchObject({
      response: { code: 'INVALID_RESERVE_QTY' },
    });
  });

  it('expiresAt uses the seller TTL override over the system setting', async () => {
    const { svc, created } = makeSut({ available: 10, sellerTtlOverride: 6, settingTtl: 48 });
    await svc.reserve(reserveInput(1));
    expect((created[0]?.expiresAt as Date).toISOString()).toBe(
      new Date(NOW.getTime() + 6 * 3_600_000).toISOString(),
    );
  });

  it('resolveTtlHours: override > setting > fallback', async () => {
    expect(await makeSut({ sellerTtlOverride: 12, settingTtl: 48 }).svc.resolveTtlHours('s1')).toBe(12);
    expect(await makeSut({ sellerTtlOverride: null, settingTtl: 48 }).svc.resolveTtlHours('s1')).toBe(48);
    expect(await makeSut({ sellerTtlOverride: null, settingTtl: null }).svc.resolveTtlHours('s1')).toBe(48);
  });
});

describe('StockReservationService.release / fulfill', () => {
  it('phase-1 release: ACTIVE -> RELEASED, returns qty, no stock_levels touch', async () => {
    const { svc, updated, levelUpdates } = makeSut({
      reservation: {
        id: 'r1',
        sellerId: 's1',
        variantId: 'v1',
        warehouseId: 'w1',
        binId: null,
        batchId: null,
        qtyReserved: 4,
        status: ReservationStatus.ACTIVE,
      },
    });
    const res = await svc.release('r1', ReservationReleaseReason.ORDER_CANCELLED, {
      type: ActorType.SYSTEM,
    });
    expect(res).toMatchObject({ qtyReleased: 4, status: ReservationStatus.RELEASED, alreadyInactive: false });
    expect(updated[0]?.data).toMatchObject({ status: ReservationStatus.RELEASED });
    expect(levelUpdates).toHaveLength(0); // phase-1: no qtyReserved change
  });

  it('phase-2 release also decrements stock_levels.qtyReserved (clamped)', async () => {
    const { svc, levelUpdates } = makeSut({
      reservation: {
        id: 'r1',
        sellerId: 's1',
        variantId: 'v1',
        warehouseId: 'w1',
        binId: 'b1',
        batchId: 'bat1',
        qtyReserved: 5,
        status: ReservationStatus.ACTIVE,
      },
    });
    await svc.release('r1', ReservationReleaseReason.EXPIRED);
    expect(levelUpdates).toHaveLength(1);
    expect(levelUpdates[0]?.where).toMatchObject({
      binId: 'b1',
      batchId: 'bat1',
      qtyReserved: { gte: 5 },
    });
    expect(levelUpdates[0]?.data).toEqual({ qtyReserved: { decrement: 5 } });
  });

  it('release is idempotent for an already-terminal reservation', async () => {
    const { svc, updated } = makeSut({
      reservation: { id: 'r1', status: ReservationStatus.RELEASED, qtyReserved: 4, binId: null, batchId: null },
    });
    const res = await svc.release('r1', ReservationReleaseReason.OTHER);
    expect(res).toMatchObject({ qtyReleased: 0, alreadyInactive: true, status: ReservationStatus.RELEASED });
    expect(updated).toHaveLength(0);
  });

  it('release throws when the reservation does not exist', async () => {
    const { svc } = makeSut({ reservation: null });
    await expect(svc.release('missing', ReservationReleaseReason.OTHER)).rejects.toMatchObject({
      response: { code: 'RESERVATION_NOT_FOUND' },
    });
  });

  it('fulfill: ACTIVE -> FULFILLED returns qty', async () => {
    const { svc, updated } = makeSut({
      reservation: {
        id: 'r1',
        sellerId: 's1',
        variantId: 'v1',
        warehouseId: 'w1',
        binId: 'b1',
        batchId: 'bat1',
        qtyReserved: 9,
        status: ReservationStatus.ACTIVE,
      },
    });
    const res = await svc.fulfill('r1');
    expect(res).toMatchObject({ qtyReleased: 9, status: ReservationStatus.FULFILLED });
    expect(updated[0]?.data).toMatchObject({ status: ReservationStatus.FULFILLED });
  });
});
