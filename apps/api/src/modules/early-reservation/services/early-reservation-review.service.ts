import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  EarlyReservationReviewStatus,
  ReservationBookingStage,
  ReservationReleaseReason,
  ReservationStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { StockReservationService } from '../../inventory-stock/services/stock-reservation.service';

export interface ReviewView {
  readonly id: string;
  readonly orderId: string;
  readonly status: EarlyReservationReviewStatus;
  readonly attemptCount: number;
  readonly heldQty: number;
  readonly note: string | null;
  readonly resolvedAt: Date | null;
  readonly createdAt: Date;
}

export type ReviewDecision = 'RELEASE' | 'REQUEST_MORE_ATTEMPTS';

/**
 * R5 — the seller's side of the manual-review path: "call attempts are
 * exhausted and we are still holding your stock; release it, or should we
 * keep trying?"
 *
 * RELEASE is complete: the at-placement holds are given back with a
 * SELLER_RELEASED reason and the review closes.
 *
 * REQUEST_MORE_ATTEMPTS currently records the seller's intent and KEEPS
 * the hold (the money-relevant half) but does NOT itself re-open the call
 * queue — deliberately, and this is a known gap rather than an oversight.
 * By the time the review exists the order is in REJECTED_NDR, which is a
 * TERMINAL status with no outbound edges in the ORD-1 matrix. Making the
 * order callable again requires one of two conscious decisions:
 *   (a) add a REJECTED_NDR → PENDING_CONFIRMATION matrix edge, or
 *   (b) for MANUAL_REVIEW sellers, suppress the REJECTED_NDR transition
 *       altogether and park the order in its pre-cap call state until the
 *       seller decides.
 * (b) is the truer model — the outcome genuinely is not decided yet — but
 * it changes what `hitCap` means for those sellers and interacts with the
 * CC-6 queue dequeue, so it belongs in its own focused change (R5b)
 * rather than being tacked on here. Until then the seller's answer is
 * durably recorded and their stock stays held, which is the part that
 * would otherwise cost them money.
 */
@Injectable()
export class EarlyReservationReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reservations: StockReservationService,
    private readonly audit: AuditLogService,
  ) {}

  async listForSeller(
    sellerId: string,
    status?: EarlyReservationReviewStatus,
  ): Promise<readonly ReviewView[]> {
    const rows = await this.prisma.client.earlyReservationReview.findMany({
      where: { sellerId, ...(status === undefined ? {} : { status }) },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toView(r));
  }

  /**
   * Applies the seller's decision. Idempotent-ish by guard: an
   * already-resolved review is a 409 rather than a silent second
   * release, so a double-click can't be mistaken for two decisions.
   */
  async decide(
    sellerId: string,
    reviewId: string,
    decision: ReviewDecision,
    sellerUserId: string,
    note?: string | null,
  ): Promise<ReviewView> {
    const existing = await this.prisma.client.earlyReservationReview.findFirst({
      where: { id: reviewId, sellerId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'EARLY_RESERVATION_REVIEW_NOT_FOUND',
        message: `Review ${reviewId} not found`,
      });
    }
    if (existing.status !== EarlyReservationReviewStatus.OPEN) {
      throw new ConflictException({
        code: 'REVIEW_ALREADY_RESOLVED',
        message: `Review ${reviewId} is already ${existing.status}`,
      });
    }

    let releasedCount = 0;
    if (decision === 'RELEASE') {
      const holds = await this.prisma.client.stockReservation.findMany({
        where: {
          orderId: existing.orderId,
          bookingStage: ReservationBookingStage.AT_PLACEMENT,
          status: ReservationStatus.ACTIVE,
        },
        select: { id: true },
      });
      for (const hold of holds) {
        const res = await this.reservations.release(
          hold.id,
          ReservationReleaseReason.SELLER_RELEASED,
          { type: ActorType.SELLER, id: sellerUserId },
        );
        if (!res.alreadyInactive) releasedCount += 1;
      }
    }

    const updated = await this.prisma.client.earlyReservationReview.update({
      where: { id: reviewId },
      data: {
        status:
          decision === 'RELEASE'
            ? EarlyReservationReviewStatus.SELLER_RELEASED
            : EarlyReservationReviewStatus.SELLER_REQUESTED_MORE_ATTEMPTS,
        resolvedAt: new Date(),
        resolvedByUserId: sellerUserId,
        note: note ?? existing.note,
      },
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      actorId: sellerUserId,
      sellerId,
      action: 'inventory.early_reservation.review_decided',
      entityType: 'order',
      entityId: existing.orderId,
      severity: 'MEDIUM',
      metadata: { reviewId, decision, releasedCount },
    });

    return this.toView(updated);
  }

  private toView(row: {
    id: string;
    orderId: string;
    status: EarlyReservationReviewStatus;
    attemptCount: number;
    heldQty: number;
    note: string | null;
    resolvedAt: Date | null;
    createdAt: Date;
  }): ReviewView {
    return {
      id: row.id,
      orderId: row.orderId,
      status: row.status,
      attemptCount: row.attemptCount,
      heldQty: row.heldQty,
      note: row.note,
      resolvedAt: row.resolvedAt,
      createdAt: row.createdAt,
    };
  }
}
