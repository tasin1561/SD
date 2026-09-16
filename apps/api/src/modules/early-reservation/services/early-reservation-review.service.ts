import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  EarlyReservationReviewStatus,
  ReservationBookingStage,
  ReservationReleaseReason,
  ReservationStatus,
  SellerStoreKind,
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

  /**
   * The reviews on ONE reseller store's own orders (2026-09-16).
   *
   * The review row carries no store id — it is keyed on the order — so
   * the scope goes through the order, which is also what makes another
   * store's review (and the seller's own channel orders) invisible here
   * rather than merely unlisted.
   */
  async listForStore(
    storeId: string,
    status?: EarlyReservationReviewStatus,
  ): Promise<readonly ReviewView[]> {
    const rows = await this.prisma.client.earlyReservationReview.findMany({
      where: {
        ...(status === undefined ? {} : { status }),
        order: { storeId, storeKind: SellerStoreKind.RESELLER, deletedAt: null },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toView(r));
  }

  /** This store's own review, or null — used to scope a decision. */
  async findForStore(storeId: string, reviewId: string): Promise<{ sellerId: string } | null> {
    return this.prisma.client.earlyReservationReview.findFirst({
      where: {
        id: reviewId,
        order: { storeId, storeKind: SellerStoreKind.RESELLER, deletedAt: null },
      },
      select: { sellerId: true },
    });
  }

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
   * Cross-seller list, for the admin queue.
   *
   * An operations person needs to see holds ageing across every seller —
   * "who has not answered" is the question, and it cannot be asked one
   * sellerId at a time. `sellerId` is an optional FILTER here rather than
   * a scope.
   *
   * Read-only on purpose: there is no admin `decide`. Releasing another
   * party's stock, or telling the call centre to keep trying on their
   * behalf, is the SELLER's commercial decision (R5) — and an unanswered
   * review does not hang either way, because the TTL sweep resolves it.
   * An admin who genuinely must intervene has god mode, which is audited
   * as the invariant-breaking act it is.
   */
  async listForAdmin(query: {
    status?: EarlyReservationReviewStatus;
    sellerId?: string;
    limit?: number;
  }): Promise<readonly (ReviewView & { sellerId: string })[]> {
    const rows = await this.prisma.client.earlyReservationReview.findMany({
      where: {
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.sellerId === undefined ? {} : { sellerId: query.sellerId }),
      },
      // Oldest first: this is a queue, and the hold that has been sitting
      // longest is the one costing the most.
      orderBy: { createdAt: 'asc' },
      take: Math.min(query.limit ?? 200, 500),
    });
    return rows.map((r) => ({ ...this.toView(r), sellerId: r.sellerId }));
  }

  /**
   * Applies the seller's decision. Idempotent-ish by guard: an
   * already-resolved review is a 409 rather than a silent second
   * release, so a double-click can't be mistaken for two decisions.
   */
  /**
   * The same decision, made by a reseller STORE on its own order
   * (2026-09-16).
   *
   * Shares `decide`'s body rather than copying it: the release of the
   * at-placement holds is the money-relevant half, and two
   * implementations of that is how one of them comes to leak stock.
   *
   * Two things differ, and both matter. `resolvedByUserId` is an FK to
   * `seller_users`, so a store user's id CANNOT go there — it stays null
   * and the actor is recorded on the audit row instead. And the holds are
   * released as the STORE, because "the store gave up on this order" and
   * "the seller did" are different facts about somebody else's customer.
   */
  async decideAsStore(
    sellerId: string,
    reviewId: string,
    decision: ReviewDecision,
    storeUserId: string,
    note?: string | null,
  ): Promise<ReviewView> {
    return this.applyDecision(sellerId, reviewId, decision, note ?? null, {
      type: ActorType.STORE,
      id: storeUserId,
      // Never written: the column only accepts a seller user.
      resolvedByUserId: null,
    });
  }

  async decide(
    sellerId: string,
    reviewId: string,
    decision: ReviewDecision,
    sellerUserId: string,
    note?: string | null,
  ): Promise<ReviewView> {
    return this.applyDecision(sellerId, reviewId, decision, note ?? null, {
      type: ActorType.SELLER,
      id: sellerUserId,
      resolvedByUserId: sellerUserId,
    });
  }

  private async applyDecision(
    sellerId: string,
    reviewId: string,
    decision: ReviewDecision,
    note: string | null,
    actor: { type: ActorType; id: string; resolvedByUserId: string | null },
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
          // Whoever actually gave the stock back. The REASON stays
          // SELLER_RELEASED — it names the decision, not the desk it was
          // made at, and a store deciding is the seller's arrangement.
          { type: actor.type, id: actor.id },
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
        // NULL when a store decided: the column is an FK to `seller_users`
        // and a store user's id would not resolve. Who acted is on the
        // audit row below, which has no such constraint.
        resolvedByUserId: actor.resolvedByUserId,
        note: note ?? existing.note,
      },
    });

    await this.audit.log({
      actorType: actor.type,
      actorId: actor.id,
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
