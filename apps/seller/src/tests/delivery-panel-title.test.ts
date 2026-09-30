import { describe, expect, it } from 'vitest';
import { deliveryPanelTitle } from '@/app/(authed)/orders/[id]/_components/delivery-trouble-panel';

/**
 * The delivery panel's heading, on an order that is no longer in
 * trouble.
 *
 * It was a two-branch ternary on the CURRENT order status:
 * DELIVERY_FAILED, or — for everything else — "Out for delivery". The
 * panel is rendered for those two statuses WHILE a parcel is moving, and
 * afterwards on any order carrying a call or a delivery request, which is
 * most of them. So a DELIVERED order printed the heading "Out for
 * delivery" two inches under a chip saying Delivered, and a returned one
 * said it too.
 *
 * Found by filming the order page (2026-09-30). The failure is a
 * FALLBACK reappearing as the primary, which is exactly what a render
 * test asserting "a heading is shown" cannot see — so this pins the
 * WORDS, per status.
 */
describe('what the delivery panel calls itself', () => {
  it('names the trouble while the parcel is still in it', () => {
    expect(deliveryPanelTitle('DELIVERY_FAILED')).toBe('Delivery did not succeed');
    expect(deliveryPanelTitle('OUT_FOR_DELIVERY')).toBe('Out for delivery');
  });

  it('does not claim a parcel is out for delivery once it has arrived', () => {
    for (const settled of ['DELIVERED', 'RTO_RESTOCKED', 'RTO_IN_TRANSIT', 'CANCELLED']) {
      expect(deliveryPanelTitle(settled)).not.toBe('Out for delivery');
      expect(deliveryPanelTitle(settled)).toBe('What happened with this delivery');
    }
  });
});
