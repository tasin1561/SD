/**
 * The payload BullMQ carries between the listener and the worker.
 * The listener fully resolves the endpoint + builds the body so the
 * worker only does I/O (HTTP POST + persist) — there's no re-fetch
 * race between enqueue and execution.
 *
 * The HMAC `signature` is computed by the listener (before enqueue)
 * so the worker doesn't need to load the endpoint's secret again
 * to fire the request — and the rotated-secret-mid-flight case is
 * thus naturally guarded: a job in flight under the OLD secret will
 * keep using the OLD signature; new jobs after rotation pick up the
 * new secret. The 24h grace window on the seller side handles both.
 */
export interface OutboundWebhookJobInput {
  /** SellerWebhookEndpoint.id (the FK target of the delivery row). */
  readonly endpointId: string;
  /** Stable event code (e.g. 'order.confirmed'). */
  readonly eventType: string;
  /** OrderEvent.id (uuidv7) — the lifecycle event identity. Same key
   *  used by the M11 ledger; lets a future reconciler stitch
   *  notifications + webhook fan-outs for the same lifecycle event. */
  readonly eventId: string;
  /** Endpoint URL at enqueue time (snapshotted — a URL edit mid-flight
   *  doesn't redirect an in-flight job). */
  readonly requestUrl: string;
  /** JSON-serializable payload. */
  readonly payload: Record<string, unknown>;
  /** Hex HMAC-SHA256 over the canonical JSON body (computed by the
   *  listener with the endpoint's secret at enqueue time). */
  readonly signature: string;
  /** Sequence number for this attempt — 1 on first schedule, ++ on
   *  the BullMQ-driven retry. We pass it through so the
   *  OutboundWebhookDelivery row attemptNumber stays accurate even
   *  across worker re-entries. */
  readonly attemptNumber: number;
}

export interface WebhookSendResult {
  readonly status: 'DELIVERED' | 'FAILED';
  readonly httpStatus: number | null;
  readonly responseTimeMs: number;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly responseBody: string | null;
}
