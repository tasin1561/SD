import { readFileSync } from 'node:fs';

import { WEBHOOK_EVENT_CATALOGUE } from '../../src/modules/seller-webhook-delivery/webhook-event-catalogue';
import { SellerWebhookController } from '../../src/modules/seller-webhook/seller-webhook.controller';
import { StoreWebhookService } from '../../src/modules/reseller-order/services/store-webhook.service';

/**
 * A seller and a reseller store are offered the SAME event list.
 *
 * The store's screen has picked from `WEBHOOK_EVENT_CATALOGUE` since
 * RS-5. The seller's was a free-text box with no vocabulary check
 * anywhere, so a typo saved cleanly and matched nothing we ever send —
 * one concept, two behaviours. The seller now picks too.
 *
 * The risk in fixing it that way is a SECOND list: two arrays that look
 * right on their own screens and disagree about what exists. So both
 * endpoints read the one module, and this asserts that as WHOLE SETS
 * rather than by spot-checking a value — the shape that
 * `order-charges-refund.service.spec.ts` was corrected to, after a
 * single-value check passed while the two sides disagreed about
 * everything else.
 */
describe('one webhook event catalogue, two screens', () => {
  it('the seller and the store are offered exactly the same events', () => {
    // Both take deps neither touches to answer this — the list is a
    // constant, which is the point.
    const seller = new SellerWebhookController({} as never).events();
    const store = new StoreWebhookService({} as never, {} as never).events();

    expect([...seller].map((e) => e.code).sort()).toEqual([...store].map((e) => e.code).sort());
    expect(seller).toEqual(store);
  });

  it('neither endpoint restates the list', () => {
    // A copy would pass the comparison above on the day it was written
    // and drift on the next release.
    for (const file of [
      'src/modules/seller-webhook/seller-webhook.controller.ts',
      'src/modules/reseller-order/services/store-webhook.service.ts',
    ]) {
      const src = readFileSync(file, 'utf8');
      expect(src).toContain('WEBHOOK_EVENT_CATALOGUE');
      // No inline array of codes beside the import.
      expect(src).not.toMatch(/code:\s*'(order|shipment)\./);
    }
  });

  it('the catalogue is not empty, so neither check passes vacuously', () => {
    expect(WEBHOOK_EVENT_CATALOGUE.length).toBeGreaterThan(10);
  });
});
