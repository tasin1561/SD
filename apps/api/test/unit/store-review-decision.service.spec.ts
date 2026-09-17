import { ResellerStoreActionMode } from '@skydrop/db';
import { StoreReviewDecisionService } from '../../src/modules/early-reservation-decision/services/store-review-decision.service';
import type { EarlyReservationDecisionService } from '../../src/modules/early-reservation-decision/services/early-reservation-decision.service';
import type { EarlyReservationReviewService } from '../../src/modules/early-reservation/services/early-reservation-review.service';
import type { StoreOrderRequestService } from '../../src/modules/store-order-request/services/store-order-request.service';
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
  reviewStatus: 'OPEN' | 'SELLER_RELEASED' = 'OPEN',
) {
  const decisions = {
    decideAsStore: jest.fn().mockResolvedValue({ review: {}, orderStatus: null, orderMoved: true }),
    listOpenForStore: jest.fn().mockResolvedValue([]),
  };
  const reviews = { findForStore: jest.fn().mockResolvedValue(owned) };
  const policies = {
    forStore: jest.fn().mockResolvedValue({ storeId: 'store-1', callCapDecision: mode }),
  };
  const requests = { hold: jest.fn().mockResolvedValue({ id: 'req-1', status: 'PENDING' }) };
  const prisma = {
    client: {
      earlyReservationReview: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ orderId: 'order-1', status: reviewStatus }),
      },
    },
  };
  return {
    decisions,
    reviews,
    policies,
    requests,
    svc: new StoreReviewDecisionService(
      prisma as never,
      decisions as unknown as EarlyReservationDecisionService,
      reviews as unknown as EarlyReservationReviewService,
      policies as unknown as ResellerStoreActionPolicyService,
      requests as unknown as StoreOrderRequestService,
    ),
  };
}

describe('a store answering the call-cap question (2026-09-16)', () => {
  it('DIRECT decides as the STORE, on the seller resolved from the review', async () => {
    const { svc, decisions } = make(ResellerStoreActionMode.DIRECT);
    const out = await svc.decide(ASK);
    expect(out.applied).toBe(true);
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

  it('OFF refuses by name before looking at the review', async () => {
    const { svc, decisions, reviews } = make(ResellerStoreActionMode.OFF);
    await expect(svc.decide(ASK)).rejects.toMatchObject({
      response: { code: 'STORE_ACTION_NOT_ALLOWED' },
    });
    expect(reviews.findForStore).not.toHaveBeenCalled();
    expect(decisions.decideAsStore).not.toHaveBeenCalled();
  });

  it('ASK_SELLER holds the proposed answer for seller staff and decides nothing (owner, 2026-09-17)', async () => {
    const { svc, decisions, requests } = make(ResellerStoreActionMode.ASK_SELLER);
    const out = await svc.decide(ASK);
    expect(out).toMatchObject({ applied: false, result: null, request: { id: 'req-1' } });
    expect(decisions.decideAsStore).not.toHaveBeenCalled();
    expect(requests.hold).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        kind: 'CALL_CAP_DECISION',
        callCapProposal: 'RELEASE',
        note: ASK.note,
      }),
    );
  });

  it('ASK_SELLER on a review already answered is refused, never held', async () => {
    const { svc, requests } = make(
      ResellerStoreActionMode.ASK_SELLER,
      { sellerId: 'seller-1' },
      'SELLER_RELEASED',
    );
    await expect(svc.decide(ASK)).rejects.toMatchObject({
      response: { code: 'REVIEW_ALREADY_RESOLVED' },
    });
    expect(requests.hold).not.toHaveBeenCalled();
  });

  it('ASK_SELLER still lets the store see what is waiting', async () => {
    const { svc, decisions } = make(ResellerStoreActionMode.ASK_SELLER);
    await svc.listOpen('store-1');
    expect(decisions.listOpenForStore).toHaveBeenCalledWith('store-1');
  });

  it('the open list is gated the same way', async () => {
    const { svc } = make(ResellerStoreActionMode.OFF);
    await expect(svc.listOpen('store-1')).rejects.toMatchObject({
      response: { code: 'STORE_ACTION_NOT_ALLOWED' },
    });
  });
});
