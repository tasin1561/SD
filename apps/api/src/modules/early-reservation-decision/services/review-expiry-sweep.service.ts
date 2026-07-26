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

    return { scanned: open.length, expired, releasedReservations, failures };
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
