import { Injectable, Logger } from '@nestjs/common';
import { ActorType, OrderStatus, ReservationReleaseReason, ReservationStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { StockReservationService } from './stock-reservation.service';

/** Cap per sweep so one run never opens an unbounded number of small
 *  release transactions; the hourly cadence drains any backlog. */
const SWEEP_BATCH_LIMIT = 500;

export interface ReservationSweepResult {
  scanned: number;
  released: number;
  skipped: number;
  /** Past their TTL but kept, because the order is on its way to a van. */
  keptForCommittedOrder: number;
}

/**
 * Orders whose stock claim the TTL must NOT touch.
 *
 * The TTL exists to stop stock being held by orders that will never
 * ship. Once an order is CONFIRMED — a person rang the customer and
 * they said yes — it IS shipping, and the claim is not the problem the
 * sweep was written to solve.
 *
 * Expiring it anyway produced exactly the mess it was meant to prevent:
 * SD-2026-26-000003 sat in PENDING_PICK while the sweep released both
 * its reservations as EXPIRED, so the order stayed in the pick queue
 * with no stock claimed. The warehouse pulled it into a batch and
 * printed a picking sheet with one parcel and zero lines — a blank
 * sheet, with nothing anywhere saying why.
 *
 * Stops at PACKED on purpose: from there the reservation has already
 * been consumed by `fulfill()` at pack (CUR-3, Model C), so nothing is
 * ACTIVE to expire and listing them would be describing a state that
 * cannot occur.
 */
const COMMITTED_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PENDING_PICK,
  OrderStatus.PICKED,
  OrderStatus.PENDING_MANUAL_PLACEMENT,
];

/**
 * Releases ACTIVE reservations whose expiresAt has passed. expiresAt was
 * fixed at reserve() time from the effective TTL
 * (seller.reservationTtlHoursOverride ?? ops.stock_reservation_ttl_hours),
 * so honoring the per-seller override needs nothing here beyond comparing
 * expiresAt to now. Each release goes through StockReservationService
 * (idempotent, transactional, audited; phase-2 rows also give back
 * stock_levels.qtyReserved).
 */
@Injectable()
export class ReservationCleanupService {
  private readonly logger = new Logger(ReservationCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reservations: StockReservationService,
  ) {}

  async sweep(now: Date = new Date()): Promise<ReservationSweepResult> {
    const due = await this.prisma.client.stockReservation.findMany({
      where: {
        status: ReservationStatus.ACTIVE,
        expiresAt: { not: null, lt: now },
      },
      orderBy: { expiresAt: 'asc' },
      take: SWEEP_BATCH_LIMIT,
      select: { id: true, order: { select: { status: true } } },
    });

    let released = 0;
    let skipped = 0;
    let keptForCommittedOrder = 0;
    for (const r of due) {
      // The order decides, not the clock. See COMMITTED_ORDER_STATUSES.
      if (r.order !== null && COMMITTED_ORDER_STATUSES.includes(r.order.status)) {
        keptForCommittedOrder += 1;
        continue;
      }
      // Idempotent: a row that transitioned (e.g. fulfilled) between the
      // scan and here returns alreadyInactive — counted as skipped.
      const res = await this.reservations.release(
        r.id,
        ReservationReleaseReason.EXPIRED,
        { type: ActorType.SYSTEM },
        now,
      );
      if (res.alreadyInactive) skipped += 1;
      else released += 1;
    }

    const result: ReservationSweepResult = {
      scanned: due.length,
      released,
      skipped,
      keptForCommittedOrder,
    };
    if (due.length > 0) {
      this.logger.log(result, 'Reservation auto-release sweep complete');
    }
    return result;
  }
}
