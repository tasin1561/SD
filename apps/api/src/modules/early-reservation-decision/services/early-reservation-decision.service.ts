import { Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  EarlyReservationReviewStatus,
  OrderStatus,
} from '@skydrop/db';
import { OrderWriteService } from '../../order/services/order-write.service';
import {
  EarlyReservationReviewService,
  type ReviewDecision,
  type ReviewView,
} from '../../early-reservation/services/early-reservation-review.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface DecisionResult {
  readonly review: ReviewView;
  /** The order's status after the decision was applied. */
  readonly orderStatus: OrderStatus | null;
  /** false ⇒ the review was recorded but the order transition did not
   *  land (already moved on, or a concurrent change). Not an error. */
  readonly orderMoved: boolean;
}

/**
 * R5b — the seller's answer to "we could not reach your customer; keep
 * trying or release?", applied to BOTH the review row and the order.
 *
 * ── WHY THIS MODULE EXISTS ────────────────────────────────────────────
 * `order` already imports `early-reservation` (OrderService takes the
 * at-placement hold), so `early-reservation` cannot import `order` back
 * to perform the transition — that is a module cycle, and the repo's R3
 * rule says extract rather than reach for forwardRef. The transition
 * boundary (`OrderWriteService`) is not extractable, so instead this LEAF
 * module composes the two: nothing imports it, so no cycle is possible.
 * Same shape as the warehouse-* modules composing order + inventory.
 *
 * ── SAGA ORDERING (visible-vs-silent) ─────────────────────────────────
 * The review decision is written FIRST (it releases the stock on RELEASE
 * and is the durable record of what the seller chose), the order
 * transition LAST. A crash between the two leaves a resolved review and
 * an order still in AWAITING_SELLER_DECISION — visible, and the sweep or
 * a re-submit converges. The inverse order could move the order while
 * losing the seller's answer.
 */
@Injectable()
export class EarlyReservationDecisionService {
  private readonly logger = new Logger(EarlyReservationDecisionService.name);

  constructor(
    private readonly reviews: EarlyReservationReviewService,
    private readonly orderWrite: OrderWriteService,
  ) {}

  async decide(
    sellerId: string,
    reviewId: string,
    decision: ReviewDecision,
    sellerUserId: string,
    note?: string | null,
    ctx?: ClientContext,
  ): Promise<DecisionResult> {
    // 1. DURABLE: record the answer + (on RELEASE) give the stock back.
    //    Throws 404/409 for an unknown or already-resolved review, so a
    //    double-submit cannot move the order twice.
    const review = await this.reviews.decide(
      sellerId,
      reviewId,
      decision,
      sellerUserId,
      note ?? null,
    );

    // 2. REFLECTION: move the order. REQUEST_MORE_ATTEMPTS goes back into
    //    the calling queue (the CC-6 post-commit hook on entry to
    //    PENDING_CONFIRMATION re-enqueues it — no extra wiring here);
    //    RELEASE lands the original NDR terminal.
    const target =
      decision === 'REQUEST_MORE_ATTEMPTS'
        ? OrderStatus.PENDING_CONFIRMATION
        : OrderStatus.REJECTED_NDR;

    try {
      const result = await this.orderWrite.transitionStatus({
        orderId: review.orderId,
        to: target,
        actor: { type: ActorType.SELLER, id: sellerUserId },
        expectedFrom: OrderStatus.AWAITING_SELLER_DECISION,
        reason:
          decision === 'REQUEST_MORE_ATTEMPTS'
            ? 'Seller asked for more call attempts'
            : 'Seller released the order after the call cap',
        ...(ctx !== undefined ? { ctx } : {}),
      });
      return { review, orderStatus: result.status, orderMoved: true };
    } catch (err) {
      // The order may legitimately have moved on (admin cancel, god
      // mode). The seller's decision is already durable, so surface the
      // review and report that the order did not move rather than
      // failing a request that DID do something.
      this.logger.warn(
        {
          orderId: review.orderId,
          reviewId,
          decision,
          err: (err as Error).message,
        },
        'Review decision recorded but the order transition did not land',
      );
      return { review, orderStatus: null, orderMoved: false };
    }
  }

  /** Reviews the seller has not answered yet. */
  async listOpen(sellerId: string): Promise<readonly ReviewView[]> {
    return this.reviews.listForSeller(
      sellerId,
      EarlyReservationReviewStatus.OPEN,
    );
  }
}
