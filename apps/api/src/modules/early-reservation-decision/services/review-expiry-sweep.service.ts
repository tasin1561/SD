import { Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  EarlyReservationReviewStatus,
  OrderStatus,
  ReservationBookingStage,
  ReservationReleaseReason,
  ReservationStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { StockReservationService } from '../../inventory-stock/services/stock-reservation.service';
import { OrderWriteService } from '../../order/services/order-write.service';

export interface SweepResult {
  readonly scanned: number;
  readonly expired: number;
  readonly releasedReservations: number;
  readonly failures: number;
}

const TTL_KEY = 'inventory.early_reservation_review_ttl_hours';
const DEFAULT_TTL_HOURS = 72;

/**
 * R5b — the answer to "what if the seller never answers?".
 *
 * Without this, AWAITING_SELLER_DECISION would be a stock-holding black
 * hole: the order sits paused, any at-placement reservation stays ACTIVE,
 * and the seller's own inventory is quietly unavailable to their other
 * orders. So an unanswered review expires: the holds are released with
 * NDR_CAP_REACHED (the same reason the auto-release path uses) and the
 * order lands the terminal it would have reached pre-R5b.
 *
 * Per-review failure isolation (mirrors the M8/M9 fan-out discipline):
 * one order that will not transition never stops the rest of the sweep.
 * Durable-first ordering per review: releases, then the review row, then
 * the order transition — a crash leaves a still-OPEN review whose holds
 * are already gone, which the next sweep converges on idempotently
 * (release is natively idempotent).
 */
@Injectable()
export class ReviewExpirySweepService {
  private readonly logger = new Logger(ReviewExpirySweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly settings: SettingsResolverService,
    private readonly reservations: StockReservationService,
    private readonly orderWrite: OrderWriteService,
  ) {}

  async sweep(): Promise<SweepResult> {
    // The TTL is resolved per SELLER (it is seller-overridable), so the
    // sweep reads candidates first and filters per row rather than
    // computing one global cutoff.
    const open = await this.prisma.client.earlyReservationReview.findMany({
      where: { status: EarlyReservationReviewStatus.OPEN },
      select: { id: true, orderId: true, sellerId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });

    let expired = 0;
    let releasedReservations = 0;
    let failures = 0;
    const now = Date.now();

    for (const review of open) {
      try {
        const ttlHours = await this.ttlHoursFor(review.sellerId);
        const ageHours = (now - review.createdAt.getTime()) / 3_600_000;
        if (ageHours < ttlHours) continue;

        releasedReservations += await this.releaseHolds(review.orderId);

        // Guarded so a seller answering at the same moment wins.
        const claimed = await this.prisma.client.earlyReservationReview.updateMany({
          where: { id: review.id, status: EarlyReservationReviewStatus.OPEN },
          data: {
            status: EarlyReservationReviewStatus.AUTO_RELEASED,
            resolvedAt: new Date(),
          },
        });
        if (claimed.count !== 1) continue;
        expired += 1;

        await this.transitionToTerminal(review.orderId);

        await this.audit.log({
          actorType: ActorType.SYSTEM,
          sellerId: review.sellerId,
          action: 'inventory.early_reservation.review_expired',
          entityType: 'order',
          entityId: review.orderId,
          severity: 'MEDIUM',
          metadata: {
            reviewId: review.id,
            ageHours: Math.round(ageHours),
            ttlHours,
          },
        });
      } catch (err) {
        failures += 1;
        this.logger.warn(
          { reviewId: review.id, orderId: review.orderId, err: (err as Error).message },
          'Review expiry failed for one review — isolated, continuing',
        );
      }
    }

    const orphans = await this.sweepOrphans(now);

    return {
      scanned: open.length + orphans.scanned,
      expired: expired + orphans.expired,
      releasedReservations: releasedReservations + orphans.released,
      failures: failures + orphans.failures,
    };
  }

  /**
   * Orders PAUSED with no review to expire.
   *
   * The pass above is driven entirely by `early_reservation_reviews`, so
   * an order sitting in AWAITING_SELLER_DECISION without one is
   * invisible to it — and nothing else moves that status. It is not
   * hypothetical: `handleNdrCap` runs BEFORE the transition and its
   * failure is caught, audited HIGH and swallowed (CC-3, correctly — the
   * attempt must not roll back), after which the transition parks the
   * order anyway. Review missing, order paused, nobody ever asked, no
   * sweep watching. SD-2026-QA-916001 has been in exactly that state
   * since 2026-07-29.
   *
   * Harmless while every seller is on AUTO_RELEASE, because the cap
   * lands on the REJECTED_NDR terminal instead. Turning MANUAL_REVIEW on
   * globally is what makes it reachable, so it is closed in the same
   * change rather than left as a thing to discover later.
   *
   * Same TTL and the same landing as an expired review: this is the
   * "nobody answered" path, arrived at by a different road.
   */
  private async sweepOrphans(
    now: number,
  ): Promise<{ scanned: number; expired: number; released: number; failures: number }> {
    const parked = await this.prisma.client.order.findMany({
      where: {
        status: OrderStatus.AWAITING_SELLER_DECISION,
        // One review per order at most (`order_id` is UNIQUE), so this
        // is "no review at all, or one that is no longer open".
        OR: [
          { earlyReservationReview: { is: null } },
          {
            earlyReservationReview: {
              status: { not: EarlyReservationReviewStatus.OPEN },
            },
          },
        ],
      },
      select: { id: true, sellerId: true, updatedAt: true },
      orderBy: { updatedAt: 'asc' },
      take: 200,
    });

    let expired = 0;
    let released = 0;
    let failures = 0;

    for (const order of parked) {
      try {
        const ttlHours = await this.ttlHoursFor(order.sellerId);
        // `updatedAt` rather than a review's `createdAt` — there is no
        // review, and the transition into the pause is the last thing
        // that touched the row.
        const ageHours = (now - order.updatedAt.getTime()) / 3_600_000;
        if (ageHours < ttlHours) continue;

        released += await this.releaseHolds(order.id);
        await this.transitionToTerminal(order.id);
        expired += 1;

        await this.audit.log({
          actorType: ActorType.SYSTEM,
          sellerId: order.sellerId,
          action: 'inventory.early_reservation.orphan_pause_expired',
          entityType: 'order',
          entityId: order.id,
          // HIGHER than an ordinary expiry: an order paused with no
          // review means the raise failed, and that is worth somebody
          // noticing rather than being tidied away silently.
          severity: 'HIGH',
          metadata: { ageHours: Math.round(ageHours), ttlHours, reason: 'no open review row' },
        });
      } catch (err) {
        failures += 1;
        this.logger.warn(
          { orderId: order.id, err: (err as Error).message },
          'Orphaned pause expiry failed for one order — isolated, continuing',
        );
      }
    }

    return { scanned: parked.length, expired, released, failures };
  }

  private async releaseHolds(orderId: string): Promise<number> {
    const holds = await this.prisma.client.stockReservation.findMany({
      where: {
        orderId,
        bookingStage: ReservationBookingStage.AT_PLACEMENT,
        status: ReservationStatus.ACTIVE,
      },
      select: { id: true },
    });
    let released = 0;
    for (const hold of holds) {
      const res = await this.reservations.release(
        hold.id,
        ReservationReleaseReason.NDR_CAP_REACHED,
        { type: ActorType.SYSTEM },
      );
      if (!res.alreadyInactive) released += 1;
    }
    return released;
  }

  /**
   * Only moves an order that is still parked. An order that has already
   * left AWAITING_SELLER_DECISION (admin cancel, god mode, a decision
   * that raced us) is left exactly where it is.
   */
  private async transitionToTerminal(orderId: string): Promise<void> {
    const order = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (order?.status !== OrderStatus.AWAITING_SELLER_DECISION) return;

    await this.orderWrite.transitionStatus({
      orderId,
      to: OrderStatus.REJECTED_NDR,
      actor: { type: ActorType.SYSTEM },
      expectedFrom: OrderStatus.AWAITING_SELLER_DECISION,
      reason: 'Seller did not answer the call-cap review within the TTL',
    });
  }

  private async ttlHoursFor(sellerId: string): Promise<number> {
    try {
      const resolved = await this.settings.resolve(sellerId, TTL_KEY);
      const n = Number(resolved.value);
      return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_HOURS;
    } catch {
      return DEFAULT_TTL_HOURS;
    }
  }
}
