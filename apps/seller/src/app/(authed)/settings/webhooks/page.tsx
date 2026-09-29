import type { ReactElement } from 'react';
import { WebhooksIndex } from './_components/webhooks-index';

/**
 * Outbound webhook configuration — sellers wire Skydrop events into
 * their own systems via HMAC-signed HTTPS POSTs.
 *
 * DELIVERY IS LIVE. This comment, the page subtitle and two more in
 * apps/api all said the worker was "deferred to Phase 1B" long after
 * `SellerWebhookDeliveryModule` was registered and
 * `OutboundWebhookListenerService` began firing real signed POSTs. A
 * seller reading the page was told their endpoint would do nothing.
 */
export default function WebhooksPage(): ReactElement {
  return <WebhooksIndex />;
}
