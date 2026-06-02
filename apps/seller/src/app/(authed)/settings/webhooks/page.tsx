import type { ReactElement } from 'react';
import { WebhooksIndex } from './_components/webhooks-index';

/**
 * Outbound webhook configuration — sellers wire Skydrop events into
 * their own systems via HMAC-signed HTTPS POSTs.
 *
 * Phase 1A scope: CRUD + secret rotation (this page). The actual
 * delivery worker is deferred to Phase 1B — endpoints configured
 * here will start firing once the worker lands; the configuration
 * shape is stable.
 */
export default function WebhooksPage(): ReactElement {
  return <WebhooksIndex />;
}
