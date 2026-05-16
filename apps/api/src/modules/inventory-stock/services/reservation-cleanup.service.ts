import { Injectable, Logger } from '@nestjs/common';
import { ActorType, ReservationReleaseReason, ReservationStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { StockReservationService } from './stock-reservation.service';

/** Cap per sweep so one run never opens an unbounded number of small
 *  release transactions; the hourly cadence drains any backlog. */
const SWEEP_BATCH_LIMIT = 500;

export interface ReservationSweepResult {
  scanned: number;
  released: number;
  skipped: number;
}

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
      select: { id: true },
    });

    let released = 0;
    let skipped = 0;
    for (const r of due) {
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
    };
    if (due.length > 0) {
      this.logger.log(result, 'Reservation auto-release sweep complete');
    }
    return result;
  }
}
