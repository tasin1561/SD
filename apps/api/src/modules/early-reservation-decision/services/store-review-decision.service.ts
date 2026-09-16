import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ResellerStoreActionMode } from '@skydrop/db';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import {
  EarlyReservationReviewService,
  type ReviewDecision,
  type ReviewView,
} from '../../early-reservation/services/early-reservation-review.service';
import { ResellerStoreActionPolicyService } from '../../reseller-store/services/reseller-store-action-policy.service';
import {
  EarlyReservationDecisionService,
  type DecisionResult,
} from './early-reservation-decision.service';

/**
 * 2026-09-16 — the policy gate in front of a reseller STORE answering
 * "we could not reach your customer; keep trying, or release?".
 *
 * On a reseller order the store is the only party who can ring the
 * customer, so they are best placed to answer it. Whether they may is
 * the SELLER's policy for that store — their stock is what is being
 * held.
 *
 * ── WHY ASK_SELLER IS A REFUSAL HERE ─────────────────────────────────
 * Answering this question is ALREADY the seller's by default: the review
 * is theirs, and the TTL sweep resolves it if nobody answers. So the
 * meaningful settings are DIRECT (the store may answer too) and OFF
 * (only the seller). ASK_SELLER would mean "the store asks the seller to
 * answer a question the seller can already answer", which is a round
 * trip with no decision in it — so it is refused by name, pointing at
 * who does it instead.
 */
@Injectable()
export class StoreReviewDecisionService {
  constructor(
    private readonly decisions: EarlyReservationDecisionService,
    private readonly reviews: EarlyReservationReviewService,
    private readonly policies: ResellerStoreActionPolicyService,
  ) {}

  /** The open reviews on this store's own orders. */
  async listOpen(storeId: string): Promise<readonly ReviewView[]> {
    await this.assertAllowed(storeId);
    return this.decisions.listOpenForStore(storeId);
  }

  async decide(input: {
    storeId: string;
    storeUserId: string;
    reviewId: string;
    decision: ReviewDecision;
    note?: string | null;
    ctx?: ClientContext;
  }): Promise<DecisionResult> {
    await this.assertAllowed(input.storeId);

    // The review must be on one of THIS store's orders. Scoped through
    // the order, because the review row carries no store id — so another
    // store's review is a 404 that says nothing about whether it exists.
    const owned = await this.reviews.findForStore(input.storeId, input.reviewId);
    if (owned === null) {
      throw new NotFoundException({
        code: 'EARLY_RESERVATION_REVIEW_NOT_FOUND',
        message: `Review ${input.reviewId} not found`,
      });
    }

    return this.decisions.decideAsStore(
      input.storeId,
      owned.sellerId,
      input.reviewId,
      input.decision,
      input.storeUserId,
      input.note ?? null,
      input.ctx,
    );
  }

  private async assertAllowed(storeId: string): Promise<void> {
    const policy = await this.policies.forStore(storeId);
    if (policy.callCapDecision !== ResellerStoreActionMode.DIRECT) {
      throw new ForbiddenException({
        code: 'STORE_ACTION_NOT_ALLOWED',
        message:
          'The seller answers call-attempt questions for this store. Ask them whether to keep trying.',
      });
    }
  }
}
