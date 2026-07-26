import {
  EarlyReservationReviewStatus,
  ReservationBookingStage,
  ReservationReleaseReason,
  ReservationStatus,
} from '@skydrop/db';
import { EarlyReservationReviewService } from '../../src/modules/early-reservation/services/early-reservation-review.service';
import type { StockReservationService } from '../../src/modules/inventory-stock/services/stock-reservation.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';

type AnyArgs = Record<string, unknown>;

const SELLER = 'seller-1';
const OTHER_SELLER = 'seller-2';
const REVIEW = 'review-1';
const ORDER = 'order-1';
const USER = 'su-1';

function row(over: AnyArgs = {}): AnyArgs {
  return {
    id: REVIEW,
    orderId: ORDER,
    sellerId: SELLER,
    status: EarlyReservationReviewStatus.OPEN,
    attemptCount: 3,
    heldQty: 5,
    note: null,
    resolvedAt: null,
    resolvedByUserId: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...over,
  };
}

function makeService(
  opts: {
    existing?: AnyArgs | null;
    holds?: AnyArgs[];
    listRows?: AnyArgs[];
    releaseAlreadyInactive?: boolean;
  } = {},
) {
  const reviewFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(
    async () => (opts.existing === undefined ? row() : opts.existing),
  );
  const reviewFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(
    async () => opts.listRows ?? [row()],
  );
  const reviewUpdate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (args) => ({
    ...row(),
    ...((args['data'] as AnyArgs | undefined) ?? {}),
  }));
  const reservationFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(
    async () => opts.holds ?? [],
  );

  const client = {
    earlyReservationReview: {
      findFirst: reviewFindFirst,
      findMany: reviewFindMany,
      update: reviewUpdate,
    },
    stockReservation: { findMany: reservationFindMany },
  };
  const prisma = { client } as unknown as PrismaService;

  const release = jest.fn<Promise<AnyArgs>, [string, ReservationReleaseReason, AnyArgs?]>(
    async () => ({ alreadyInactive: opts.releaseAlreadyInactive ?? false }),
  );
  const reservations = { release };

  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a1');
  const audit = { log: auditLog };

  const svc = new EarlyReservationReviewService(
    prisma,
    reservations as unknown as StockReservationService,
    audit as unknown as AuditLogService,
  );
  return { svc, release, reviewUpdate, reviewFindFirst, reviewFindMany, reservationFindMany, auditLog };
}

describe('EarlyReservationReviewService.listForSeller', () => {
  it('scopes every read to the calling seller', async () => {
    const { svc, reviewFindMany } = makeService();
    await svc.listForSeller(SELLER);
    expect(reviewFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sellerId: SELLER } }),
    );
  });

  it('filters by status when one is supplied', async () => {
    const { svc, reviewFindMany } = makeService();
    await svc.listForSeller(SELLER, EarlyReservationReviewStatus.OPEN);
    expect(reviewFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sellerId: SELLER, status: EarlyReservationReviewStatus.OPEN },
      }),
    );
  });

  it('projects rows to the seller-safe view', async () => {
    const { svc } = makeService({ listRows: [row({ note: 'hold it' })] });
    const [view] = await svc.listForSeller(SELLER);
    expect(view).toEqual({
      id: REVIEW,
      orderId: ORDER,
      status: EarlyReservationReviewStatus.OPEN,
      attemptCount: 3,
      heldQty: 5,
      note: 'hold it',
      resolvedAt: null,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    // sellerId / resolvedByUserId / updatedAt are internal — never projected.
    expect(view).not.toHaveProperty('sellerId');
  });
});

describe('EarlyReservationReviewService.decide', () => {
  it("404s on another seller's review (the lookup is seller-scoped)", async () => {
    const { svc, reviewFindFirst } = makeService({ existing: null });
    await expect(svc.decide(OTHER_SELLER, REVIEW, 'RELEASE', USER)).rejects.toMatchObject({
      response: { code: 'EARLY_RESERVATION_REVIEW_NOT_FOUND' },
    });
    expect(reviewFindFirst).toHaveBeenCalledWith({
      where: { id: REVIEW, sellerId: OTHER_SELLER },
    });
  });

  it('409s rather than releasing twice when the review is already resolved', async () => {
    const { svc, release } = makeService({
      existing: row({ status: EarlyReservationReviewStatus.SELLER_RELEASED }),
    });
    await expect(svc.decide(SELLER, REVIEW, 'RELEASE', USER)).rejects.toMatchObject({
      response: { code: 'REVIEW_ALREADY_RESOLVED' },
    });
    expect(release).not.toHaveBeenCalled();
  });

  it('RELEASE gives back every ACTIVE at-placement hold with SELLER_RELEASED', async () => {
    const { svc, release, reviewUpdate, reservationFindMany, auditLog } = makeService({
      holds: [{ id: 'r1' }, { id: 'r2' }],
    });
    const view = await svc.decide(SELLER, REVIEW, 'RELEASE', USER, 'not worth holding');

    expect(reservationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orderId: ORDER,
          bookingStage: ReservationBookingStage.AT_PLACEMENT,
          status: ReservationStatus.ACTIVE,
        },
        select: { id: true },
      }),
    );
    expect(release).toHaveBeenCalledTimes(2);
    expect(release.mock.calls[0]![1]).toBe(ReservationReleaseReason.SELLER_RELEASED);
    expect(view.status).toBe(EarlyReservationReviewStatus.SELLER_RELEASED);
    expect(reviewUpdate.mock.calls[0]![0]).toMatchObject({
      where: { id: REVIEW },
      data: expect.objectContaining({
        status: EarlyReservationReviewStatus.SELLER_RELEASED,
        resolvedByUserId: USER,
        note: 'not worth holding',
      }),
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inventory.early_reservation.review_decided',
        metadata: expect.objectContaining({ decision: 'RELEASE', releasedCount: 2 }),
      }),
    );
  });

  it('an already-inactive hold is not counted as a release', async () => {
    const { svc, auditLog } = makeService({
      holds: [{ id: 'r1' }],
      releaseAlreadyInactive: true,
    });
    await svc.decide(SELLER, REVIEW, 'RELEASE', USER);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ releasedCount: 0 }) }),
    );
  });

  it('REQUEST_MORE_ATTEMPTS records the intent and KEEPS the stock held', async () => {
    const { svc, release, reservationFindMany, reviewUpdate } = makeService({
      holds: [{ id: 'r1' }],
    });
    const view = await svc.decide(SELLER, REVIEW, 'REQUEST_MORE_ATTEMPTS', USER);
    // The money-relevant half: nothing is released, and we don't even look.
    expect(reservationFindMany).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(view.status).toBe(EarlyReservationReviewStatus.SELLER_REQUESTED_MORE_ATTEMPTS);
    expect(reviewUpdate.mock.calls[0]![0]).toMatchObject({
      data: expect.objectContaining({
        status: EarlyReservationReviewStatus.SELLER_REQUESTED_MORE_ATTEMPTS,
      }),
    });
  });

  it('an omitted note preserves the existing one instead of nulling it', async () => {
    const { svc, reviewUpdate } = makeService({ existing: row({ note: 'raised by system' }) });
    await svc.decide(SELLER, REVIEW, 'REQUEST_MORE_ATTEMPTS', USER);
    expect(reviewUpdate.mock.calls[0]![0]).toMatchObject({
      data: expect.objectContaining({ note: 'raised by system' }),
    });
  });
});
