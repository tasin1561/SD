import { SellerWebhookService } from '../../src/modules/seller-webhook/services/seller-webhook.service';
import { StoreWebhookService } from '../../src/modules/reseller-order/services/store-webhook.service';

/**
 * RE-ENABLING AN AUTO-DISABLED ENDPOINT MUST CLEAR THE STAMP.
 *
 * Auto-disable sets `isActive = false` AND stamps `autoDisabledAt`, and
 * `OutboundWebhookListenerService` selects on `isActive: true AND
 * autoDisabledAt: null`. So an update that writes `isActive` alone flips
 * the switch on, leaves the row's chip reading "Auto-disabled", and sends
 * nothing — for ever, because nothing else in the codebase ever clears
 * that column. The seller's only way out was to delete the endpoint and
 * add it again, which issues a new secret they then have to redeploy.
 *
 * It is written against BOTH services in one file on purpose: they share
 * this table, this dispatcher and this listener, and for a long time only
 * the store one was right. A fix to either that leaves the other behind
 * fails here.
 *
 * The assertion is on the `data` handed to Prisma rather than on a
 * round-trip, because the bug is exactly that three fields were missing
 * from that object — a fake that answered every update alike could not
 * see it.
 */
type Captured = Record<string, unknown>;

function fakePrisma(captured: Captured[]): {
  client: {
    sellerWebhookEndpoint: {
      findFirst: () => Promise<{ id: string; secretKey: string }>;
      update: (args: { data: Captured }) => Promise<Record<string, unknown>>;
    };
  };
} {
  return {
    client: {
      sellerWebhookEndpoint: {
        findFirst: () => Promise.resolve({ id: 'ep-1', secretKey: 'old' }),
        update: ({ data }) => {
          captured.push(data);
          return Promise.resolve({ id: 'ep-1' });
        },
      },
    },
  };
}

describe('re-enabling a webhook endpoint', () => {
  describe.each([
    [
      'seller',
      (captured: Captured[]) =>
        new SellerWebhookService(
          fakePrisma(captured) as never,
          { assertPublicHttpsUrl: () => Promise.resolve() } as never,
        ),
      (svc: unknown, isActive: boolean) =>
        (svc as SellerWebhookService).update('seller-1', 'ep-1', { isActive } as never),
    ],
    [
      'store',
      (captured: Captured[]) =>
        new StoreWebhookService(
          fakePrisma(captured) as never,
          {
            log: () => Promise.resolve(),
          } as never,
        ),
      (svc: unknown, isActive: boolean) =>
        (svc as StoreWebhookService).update(
          { storeId: 'store-1', storeUserId: 'u-1' } as never,
          'ep-1',
          { isActive } as never,
        ),
    ],
  ])('%s endpoints', (_kind, make, update) => {
    it('clears the auto-disable stamp and the failure streak when switched ON', async () => {
      const captured: Captured[] = [];
      await update(make(captured), true);

      expect(captured).toHaveLength(1);
      expect(captured[0]).toMatchObject({
        isActive: true,
        autoDisabledAt: null,
        autoDisabledReason: null,
        consecutiveFailureCount: 0,
      });
    });

    it('leaves the stamp alone when switched OFF', async () => {
      const captured: Captured[] = [];
      await update(make(captured), false);

      expect(captured).toHaveLength(1);
      expect(captured[0]).toEqual({ isActive: false });
    });
  });
});
