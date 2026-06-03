import type { ReactElement } from 'react';
import { WebhookDeliveriesIndex } from './_components/webhook-deliveries-index';

/**
 * Phase 1B bundle #4 — admin view of outbound webhook deliveries.
 *
 * Diagnostic view for ops: which fires succeeded, which failed, what
 * the response status / time / error code was. Read-only.
 */
export default function WebhooksPage(): ReactElement {
  return <WebhookDeliveriesIndex />;
}
