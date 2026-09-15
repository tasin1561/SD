import { OrderStatus } from '@skydrop/db';
import { WebhookEventMappingService } from '../../src/modules/seller-webhook-delivery/services/webhook-event-mapping.service';
import {
  unknownWebhookEvents,
  WEBHOOK_EVENT_CATALOGUE,
} from '../../src/modules/seller-webhook-delivery/webhook-event-catalogue';

/**
 * The store's webhook form offers WEBHOOK_EVENT_CATALOGUE, and a store
 * endpoint may subscribe to nothing else (UI audit, 2026-09-15). The list is
 * declared, so it is pinned here against the F2 switch that actually picks
 * the code for each status, in BOTH directions: a code nothing sends would
 * be a checkbox that never fires; a code the pipeline sends but the list
 * lacks would be an event no store can hear.
 */
describe('webhook event catalogue', () => {
  const mapping = new WebhookEventMappingService();
  const sent = new Set(
    Object.values(OrderStatus)
      .map((s) => mapping.resolveForOrderStatus(s))
      .filter((c): c is string => c !== null),
  );
  const listed = new Set(WEBHOOK_EVENT_CATALOGUE.map((e) => e.code));

  it('lists every code the pipeline sends', () => {
    expect([...sent].filter((c) => !listed.has(c))).toEqual([]);
  });

  it('lists nothing the pipeline never sends', () => {
    expect([...listed].filter((c) => !sent.has(c))).toEqual([]);
  });

  it('lists each code once, with words to pick it by', () => {
    expect(listed.size).toBe(WEBHOOK_EVENT_CATALOGUE.length);
    for (const e of WEBHOOK_EVENT_CATALOGUE) expect(e.description.trim()).not.toBe('');
  });

  it('names the codes it does not know', () => {
    expect(unknownWebhookEvents(['order.confirmed', 'order.shipped', 'nope'])).toEqual([
      'order.shipped',
      'nope',
    ]);
    expect(unknownWebhookEvents(['shipment.delivered'])).toEqual([]);
  });
});
