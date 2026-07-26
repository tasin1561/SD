import {
  EarlyReservationReviewStatus,
  ReservationBookingStage,
  ReservationReleaseReason,
} from '@skydrop/db';
import { EarlyReservationService } from '../../src/modules/early-reservation/services/early-reservation.service';
import {
  InsufficientStockError,
  type StockReservationService,
} from '../../src/modules/inventory-stock/services/stock-reservation.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { SettingsResolverService } from '../../src/modules/settings/services/settings-resolver.service';

type AnyArgs = Record<string, unknown>;

const ORDER = 'order-1';
const SELLER = 'seller-1';
const WH = 'wh-1';

const LINES = [
  { orderItemId: 'oi-1', variantId: 'v-1', quantity: 2 },
  { orderItemId: 'oi-2', variantId: 'v-2', quantity: 3 },
];

function makeService(
  opts: {
    enabled?: boolean;
    ndrAction?: string;
    ttlHours?: number;
    existingHold?: AnyArgs | null;
    holds?: AnyArgs[];
    reserveFails?: 'insufficient' | 'other' | 'none';
    settingsThrows?: boolean;
    releaseAlreadyInactive?: boolean;
  } = {},
) {
  const reservationFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(
    async () => (opts.existingHold === undefined ? null : opts.existingHold),
  );
  const reservationFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(
    async () => opts.holds ?? [],
  );
  const reviewUpsert = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({
    id: 'review-1',
    status: EarlyReservationReviewStatus.OPEN,
  }));
  const client = {
    stockReservation: { findFirst: reservationFindFirst, findMany: reservationFindMany },
    earlyReservationReview: { upsert: reviewUpsert },
  };
  const prisma = { client } as unknown as PrismaService;

  const reserve = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => {
    if (opts.reserveFails === 'insufficient') throw new InsufficientStockError(5, 1);
    if (opts.reserveFails === 'other') throw new Error('db blew up');
    return { id: 'res-1' };
  });
  const release = jest.fn<Promise<AnyArgs>, [string, ReservationReleaseReason, AnyArgs?]>(
    async () => ({ alreadyInactive: opts.releaseAlreadyInactive ?? false }),
  );
  const reservations = { reserve, release };

  const resolve = jest.fn(async (_sellerId: string, key: string) => {
    if (opts.settingsThrows) throw new Error('settings down');
    if (key === 'inventory.early_reservation_enabled') {
      return { key, valueType: 'BOOLEAN', value: opts.enabled ?? false, source: 'SYSTEM_DEFAULT' as const };
    }
    if (key === 'inventory.early_reservation_ndr_action') {
      return { key, valueType: 'STRING', value: opts.ndrAction ?? 'AUTO_RELEASE', source: 'SYSTEM_DEFAULT' as const };
    }
    if (key === 'inventory.early_reservation_ttl_hours') {
      return { key, valueType: 'INT', value: opts.ttlHours ?? 24, source: 'SYSTEM_DEFAULT' as const };
    }
    throw new Error(`unexpected key ${key}`);
  });
  const settings = { resolve };

  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a1');
  const audit = { log: auditLog };

  const svc = new EarlyReservationService(
    prisma,
    reservations as unknown as StockReservationService,
    settings as unknown as SettingsResolverService,
    audit as unknown as AuditLogService,
  );
  return { svc, reserve, release, reviewUpsert, auditLog, reservationFindMany };
}

describe('EarlyReservationService.reserveAtPlacement', () => {
  const req = { orderId: ORDER, sellerId: SELLER, warehouseId: WH, lines: LINES };

  it('no-ops when the seller has NOT opted in (the default)', async () => {
    const { svc, reserve } = makeService({ enabled: false });
    const r = await svc.reserveAtPlacement(req);
    expect(r).toEqual({ reserved: 0, skipped: 2, enabled: false });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('reserves every line at the AT_PLACEMENT stage with the early TTL', async () => {
    const { svc, reserve, auditLog } = makeService({ enabled: true, ttlHours: 12 });
    const r = await svc.reserveAtPlacement(req);
    expect(r).toEqual({ reserved: 2, skipped: 0, enabled: true });
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(reserve.mock.calls[0]![0]).toMatchObject({
      sellerId: SELLER,
      variantId: 'v-1',
      warehouseId: WH,
      qtyToReserve: 2,
      orderId: ORDER,
      orderItemId: 'oi-1',
      bookingStage: ReservationBookingStage.AT_PLACEMENT,
      ttlHoursOverride: 12,
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'inventory.early_reservation.created' }),
    );
  });

  it('is idempotent: an existing ACTIVE at-placement hold short-circuits', async () => {
    const { svc, reserve } = makeService({ enabled: true, existingHold: { id: 'res-existing' } });
    const r = await svc.reserveAtPlacement(req);
    expect(r.reserved).toBe(0);
    expect(reserve).not.toHaveBeenCalled();
  });

  it('insufficient stock does NOT throw — order creation must never fail on this', async () => {
    const { svc } = makeService({ enabled: true, reserveFails: 'insufficient' });
    const r = await svc.reserveAtPlacement(req);
    expect(r).toEqual({ reserved: 0, skipped: 2, enabled: true });
  });

  it('an unexpected per-line error is isolated, not propagated', async () => {
    const { svc } = makeService({ enabled: true, reserveFails: 'other' });
    await expect(svc.reserveAtPlacement(req)).resolves.toMatchObject({ reserved: 0, skipped: 2 });
  });

  it('a wholesale settings failure degrades to a no-op instead of throwing', async () => {
    const { svc, reserve } = makeService({ settingsThrows: true });
    const r = await svc.reserveAtPlacement(req);
    expect(r.enabled).toBe(false);
    expect(reserve).not.toHaveBeenCalled();
  });
});

describe('EarlyReservationService.handleNdrCap', () => {
  it('NO_EARLY_HOLD when the order has no at-placement holds', async () => {
    const { svc, release, reviewUpsert } = makeService({ holds: [] });
    const r = await svc.handleNdrCap(ORDER, SELLER, 3);
    expect(r).toEqual({ kind: 'NO_EARLY_HOLD' });
    expect(release).not.toHaveBeenCalled();
    expect(reviewUpsert).not.toHaveBeenCalled();
  });

  it('AUTO_RELEASE (default) releases every hold with NDR_CAP_REACHED', async () => {
    const { svc, release, reviewUpsert, auditLog } = makeService({
      ndrAction: 'AUTO_RELEASE',
      holds: [
        { id: 'r1', qtyReserved: 2 },
        { id: 'r2', qtyReserved: 3 },
      ],
    });
    const r = await svc.handleNdrCap(ORDER, SELLER, 3);
    expect(r).toEqual({ kind: 'AUTO_RELEASED', releasedCount: 2 });
    expect(release).toHaveBeenCalledTimes(2);
    expect(release.mock.calls[0]![1]).toBe(ReservationReleaseReason.NDR_CAP_REACHED);
    expect(reviewUpsert).not.toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'inventory.early_reservation.auto_released' }),
    );
  });

  it('MANUAL_REVIEW raises a review with the held qty and releases NOTHING', async () => {
    const { svc, release, reviewUpsert, auditLog } = makeService({
      ndrAction: 'MANUAL_REVIEW',
      holds: [
        { id: 'r1', qtyReserved: 2 },
        { id: 'r2', qtyReserved: 3 },
      ],
    });
    const r = await svc.handleNdrCap(ORDER, SELLER, 4);
    expect(r).toEqual({ kind: 'MANUAL_REVIEW', reviewId: 'review-1', heldQty: 5 });
    expect(release).not.toHaveBeenCalled();
    const args = reviewUpsert.mock.calls[0]![0]!;
    expect(args).toMatchObject({ where: { orderId: ORDER } });
    expect(args.create).toMatchObject({ orderId: ORDER, sellerId: SELLER, attemptCount: 4, heldQty: 5 });
    // upsert with an empty update => re-running never overwrites the
    // original review.
    expect(args.update).toEqual({});
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'inventory.early_reservation.review_raised' }),
    );
  });

  it('queries only ACTIVE at-placement holds for this order', async () => {
    const { svc, reservationFindMany } = makeService({ holds: [] });
    await svc.handleNdrCap(ORDER, SELLER, 3);
    expect(reservationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orderId: ORDER,
          bookingStage: ReservationBookingStage.AT_PLACEMENT,
          status: 'ACTIVE',
        }),
      }),
    );
  });

  it('an already-inactive hold is not double-counted as released', async () => {
    const { svc } = makeService({
      ndrAction: 'AUTO_RELEASE',
      holds: [{ id: 'r1', qtyReserved: 2 }],
      releaseAlreadyInactive: true,
    });
    const r = await svc.handleNdrCap(ORDER, SELLER, 3);
    expect(r).toEqual({ kind: 'AUTO_RELEASED', releasedCount: 0 });
  });
});
