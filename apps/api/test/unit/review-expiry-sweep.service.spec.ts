import {
  EarlyReservationReviewStatus,
  OrderStatus,
  ReservationReleaseReason,
  SettingValueType,
} from '@skydrop/db';
import { ReviewExpirySweepService } from '../../src/modules/early-reservation-decision/services/review-expiry-sweep.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { SettingsResolverService } from '../../src/modules/settings/services/settings-resolver.service';
import type { StockReservationService } from '../../src/modules/inventory-stock/services/stock-reservation.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';

type AnyArgs = Record<string, unknown>;

const SELLER = 'seller-1';
const HOURS = 3_600_000;

function review(over: AnyArgs = {}): AnyArgs {
  return {
    id: 'review-1',
    orderId: 'order-1',
    sellerId: SELLER,
    // 100h old against a 72h default TTL ⇒ expired.
    createdAt: new Date(Date.now() - 100 * HOURS),
    ...over,
  };
}

function makeSut(
  opts: {
    reviews?: AnyArgs[];
    holds?: AnyArgs[];
    ttlHours?: number;
    settingsThrows?: boolean;
    claimCount?: number;
    orderStatus?: OrderStatus;
    transitionThrows?: boolean;
    releaseAlreadyInactive?: boolean;
  } = {},
) {
  const reviewFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(
    async () => opts.reviews ?? [review()],
  );
  const reviewUpdateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(
    async () => ({ count: opts.claimCount ?? 1 }),
  );
  const reservationFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(
    async () => opts.holds ?? [{ id: 'r1' }],
  );
  const orderFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () => ({
    status: opts.orderStatus ?? OrderStatus.AWAITING_SELLER_DECISION,
  }));

  const prisma = {
    client: {
      earlyReservationReview: {
        findMany: reviewFindMany,
        updateMany: reviewUpdateMany,
      },
      stockReservation: { findMany: reservationFindMany },
      order: { findUnique: orderFindUnique },
    },
  } as unknown as PrismaService;

  const release = jest.fn<Promise<{ alreadyInactive: boolean }>, [string, ReservationReleaseReason, AnyArgs?]>(
    async () => ({ alreadyInactive: opts.releaseAlreadyInactive ?? false }),
  );
  const reservations = { release } as unknown as StockReservationService;

  const transitionStatus = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => {
    if (opts.transitionThrows) throw new Error('boom');
    return { status: OrderStatus.REJECTED_NDR };
  });
  const orderWrite = { transitionStatus } as unknown as OrderWriteService;

  const resolve = jest.fn(async (_s: string, key: string) => {
    if (opts.settingsThrows) throw new Error('settings down');
    return {
      key,
      valueType: SettingValueType.INT,
      value: opts.ttlHours ?? 72,
      source: 'SYSTEM_DEFAULT' as const,
    };
  });
  const settings = { resolve } as unknown as SettingsResolverService;

  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a1');
  const audit = { log: auditLog } as unknown as AuditLogService;

  return {
    svc: new ReviewExpirySweepService(prisma, audit, settings, reservations, orderWrite),
    release,
    transitionStatus,
    reviewUpdateMany,
    auditLog,
    reviewFindMany,
  };
}

describe('ReviewExpirySweepService.sweep', () => {
  it('expires an over-TTL review: releases holds, closes it, rejects the order', async () => {
    const sut = makeSut();
    const r = await sut.svc.sweep();

    expect(r).toMatchObject({ scanned: 1, expired: 1, releasedReservations: 1, failures: 0 });
    expect(sut.release.mock.calls[0]![1]).toBe(ReservationReleaseReason.NDR_CAP_REACHED);
    expect(sut.reviewUpdateMany.mock.calls[0]![0]).toMatchObject({
      data: expect.objectContaining({
        status: EarlyReservationReviewStatus.AUTO_RELEASED,
      }),
    });
    expect(sut.transitionStatus.mock.calls[0]![0]).toMatchObject({
      to: OrderStatus.REJECTED_NDR,
      expectedFrom: OrderStatus.AWAITING_SELLER_DECISION,
    });
    expect(sut.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'inventory.early_reservation.review_expired' }),
    );
  });

  it('leaves a review that is still within its TTL completely alone', async () => {
    const sut = makeSut({
      reviews: [review({ createdAt: new Date(Date.now() - 10 * HOURS) })],
    });
    const r = await sut.svc.sweep();
    expect(r).toMatchObject({ scanned: 1, expired: 0, releasedReservations: 0 });
    expect(sut.release).not.toHaveBeenCalled();
    expect(sut.transitionStatus).not.toHaveBeenCalled();
  });

  it("honours a seller's longer TTL override", async () => {
    const sut = makeSut({ ttlHours: 240 }); // 10 days > the 100h-old review
    const r = await sut.svc.sweep();
    expect(r.expired).toBe(0);
  });

  it('falls back to the 72h default when the TTL setting is unreadable', async () => {
    const sut = makeSut({ settingsThrows: true });
    const r = await sut.svc.sweep();
    expect(r.expired).toBe(1); // 100h old > 72h default
  });

  it('a seller answering at the same moment wins — the guarded claim loses', async () => {
    const sut = makeSut({ claimCount: 0 });
    const r = await sut.svc.sweep();
    expect(r.expired).toBe(0);
    expect(sut.transitionStatus).not.toHaveBeenCalled();
  });

  it('does not move an order that already left the pause', async () => {
    const sut = makeSut({ orderStatus: OrderStatus.CANCELLED_BY_ADMIN });
    const r = await sut.svc.sweep();
    expect(r.expired).toBe(1); // the review is still closed out
    expect(sut.transitionStatus).not.toHaveBeenCalled();
  });

  it('isolates a per-review failure instead of aborting the sweep', async () => {
    const sut = makeSut({
      reviews: [review({ id: 'r-bad' }), review({ id: 'r-good', orderId: 'order-2' })],
      transitionThrows: true,
    });
    const r = await sut.svc.sweep();
    expect(r.scanned).toBe(2);
    expect(r.failures).toBe(2); // both fail independently; neither stops the loop
  });

  it('an already-inactive hold is not counted as released', async () => {
    const sut = makeSut({ releaseAlreadyInactive: true });
    const r = await sut.svc.sweep();
    expect(r.releasedReservations).toBe(0);
    expect(r.expired).toBe(1);
  });

  it('scans only OPEN reviews, oldest first', async () => {
    const sut = makeSut();
    await sut.svc.sweep();
    // A resolved review must never be re-touched, and the oldest debt to
    // the seller's stock is dealt with first.
    expect(sut.reviewFindMany.mock.calls[0]![0]).toMatchObject({
      where: { status: EarlyReservationReviewStatus.OPEN },
      orderBy: { createdAt: 'asc' },
    });
  });
});
