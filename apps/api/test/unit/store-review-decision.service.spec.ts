import { ResellerStoreActionMode } from '@skydrop/db';
import { StoreReviewDecisionService } from '../../src/modules/early-reservation-decision/services/store-review-decision.service';
import type { EarlyReservationDecisionService } from '../../src/modules/early-reservation-decision/services/early-reservation-decision.service';
import type { EarlyReservationReviewService } from '../../src/modules/early-reservation/services/early-reservation-review.service';
import type { ResellerStoreActionPolicyService } from '../../src/modules/reseller-store/services/reseller-store-action-policy.service';

const ASK = {
  storeId: 'store-1',
  storeUserId: 'su-1',
  reviewId: 'rev-1',
  decision: 'RELEASE' as const,
  note: 'Customer says they no longer want it.',
};

function make(
  mode: ResellerStoreActionMode,
  owned: { sellerId: string } | null = { sellerId: 'seller-1' },
) {
  const decisions = {
    decideAsStore: jest.fn().mockResolvedValue({ review: {}, orderStatus: null, orderMoved: true }),
    listOpenForStore: jest.fn().mockResolvedValue([]),
  };
  const reviews = { findForStore: jest.fn().mockResolvedValue(owned) };
  const policies = {
    forStore: jest.fn().mockResolvedValue({ storeId: 'store-1', callCapDecision: mode }),
  };
  return {
    decisions,
    reviews,
    policies,
    svc: new StoreReviewDecisionService(
      decisions as unknown as EarlyReservationDecisionService,
      reviews as unknown as EarlyReservationReviewService,
      policies as unknown as ResellerStoreActionPolicyService,
    ),
  };
}

describe('a store answering the call-cap question (2026-09-16)', () => {
  it('DIRECT decides as the STORE, on the seller resolved from the review', async () => {
    const { svc, decisions } = make(ResellerStoreActionMode.DIRECT);
    await svc.decide(ASK);
    expect(decisions.decideAsStore).toHaveBeenCalledWith(
      'store-1',
      'seller-1',
      'rev-1',
      'RELEASE',
      'su-1',
      ASK.note,
      undefined,
    );
  });

  it('a review on another store’s order is a 404, and decides nothing', async () => {
    const { svc, decisions } = make(ResellerStoreActionMode.DIRECT, null);
    await expect(svc.decide(ASK)).rejects.toMatchObject({
      response: { code: 'EARLY_RESERVATION_REVIEW_NOT_FOUND' },
    });
    expect(decisions.decideAsStore).not.toHaveBeenCalled();
  });

  it('OFF and ASK_SELLER both leave it to the seller', async () => {
    // Answering is ALREADY the seller's, and the TTL sweep closes it if
    // nobody does — so "ask the seller" would be a round trip with no
    // decision in it. Refused by name, pointing at who does it.
    for (const mode of [ResellerStoreActionMode.OFF, ResellerStoreActionMode.ASK_SELLER]) {
      const { svc, decisions, reviews } = make(mode);
      await expect(svc.decide(ASK)).rejects.toMatchObject({
        response: { code: 'STORE_ACTION_NOT_ALLOWED' },
      });
      expect(reviews.findForStore).not.toHaveBeenCalled();
      expect(decisions.decideAsStore).not.toHaveBeenCalled();
    }
  });

  it('the open list is gated the same way', async () => {
    const { svc } = make(ResellerStoreActionMode.OFF);
    await expect(svc.listOpen('store-1')).rejects.toMatchObject({
      response: { code: 'STORE_ACTION_NOT_ALLOWED' },
    });
  });
});
