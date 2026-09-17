import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EarlyReservationReviewStatus,
  ResellerStoreActionMode,
  StoreCallCapProposal,
  StoreOrderRequestKind,
} from '@skydrop/db';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import {
  EarlyReservationReviewService,
  type ReviewDecision,
  type ReviewView,
} from '../../early-reservation/services/early-reservation-review.service';
import { ResellerStoreActionPolicyService } from '../../reseller-store/services/reseller-store-action-policy.service';
import {
  StoreOrderRequestService,
  type StoreOrderRequestView,
} from '../../store-order-request/services/store-order-request.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  EarlyReservationDecisionService,
  type DecisionResult,
} from './early-reservation-decision.service';

/**
 * What came of a store's answer: applied, or waiting on seller staff.
 * A union rather than a nullable result — the address-correction shape.
 */
export type StoreReviewOutcome =
  | { readonly applied: true; readonly result: DecisionResult; readonly request: null }
  | { readonly applied: false; readonly result: null; readonly request: StoreOrderRequestView };

/**
 * 2026-09-16 — the policy gate in front of a reseller STORE answering
 * "we could not reach your customer; keep trying, or release?".
 *
 * On a reseller order the store is the only party who can ring the
 * customer, so they are best placed to answer it. Whether they may, and
 * HOW, is the SELLER's policy for that store — their stock is what is
 * being held.
 *
 * ── ASK_SELLER IS A HELD REQUEST (2026-09-17, owner) ─────────────────
 * It used to refuse, on the reasoning that the seller can answer the
 * review themselves. The owner's rule is that every capability may be
 * set to "needs my approval", so the store PROPOSES an answer and seller
 * staff approve or reject that proposal; approving runs the same
 * `decideAsStore` a DIRECT answer runs, as the store.
 */
@Injectable()
export class StoreReviewDecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly decisions: EarlyReservationDecisionService,
    private readonly reviews: EarlyReservationReviewService,
    private readonly policies: ResellerStoreActionPolicyService,
    private readonly requests: StoreOrderRequestService,
  ) {}

  /** The open reviews on this store's own orders. */
  async listOpen(storeId: string): Promise<readonly ReviewView[]> {
    await this.policyMode(storeId);
    return this.decisions.listOpenForStore(storeId);
  }

  async decide(input: {
    storeId: string;
    storeUserId: string;
    reviewId: string;
    decision: ReviewDecision;
    note?: string | null;
    ctx?: ClientContext;
  }): Promise<StoreReviewOutcome> {
    const mode = await this.policyMode(input.storeId);

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

    if (mode === ResellerStoreActionMode.ASK_SELLER) {
      const review = await this.prisma.client.earlyReservationReview.findUniqueOrThrow({
        where: { id: input.reviewId },
        select: { orderId: true, status: true },
      });
      if (review.status !== EarlyReservationReviewStatus.OPEN) {
        throw new ConflictException({
          code: 'REVIEW_ALREADY_RESOLVED',
          message: 'This question has already been answered.',
        });
      }
      const request = await this.requests.hold({
        storeId: input.storeId,
        storeUserId: input.storeUserId,
        orderId: review.orderId,
        kind: StoreOrderRequestKind.CALL_CAP_DECISION,
        note: input.note ?? null,
        callCapProposal:
          input.decision === 'RELEASE'
            ? StoreCallCapProposal.RELEASE
            : StoreCallCapProposal.REQUEST_MORE_ATTEMPTS,
      });
      return { applied: false, result: null, request };
    }

    const result = await this.decisions.decideAsStore(
      input.storeId,
      owned.sellerId,
      input.reviewId,
      input.decision,
      input.storeUserId,
      input.note ?? null,
      input.ctx,
    );
    return { applied: true, result, request: null };
  }

  /** The store's mode for this capability; OFF is refused by name. */
  private async policyMode(storeId: string): Promise<ResellerStoreActionMode> {
    const policy = await this.policies.forStore(storeId);
    if (policy.callCapDecision === ResellerStoreActionMode.OFF) {
      throw new ForbiddenException({
        code: 'STORE_ACTION_NOT_ALLOWED',
        message:
          'The seller answers call-attempt questions for this store. Ask them whether to keep trying.',
      });
    }
    return policy.callCapDecision;
  }
}
