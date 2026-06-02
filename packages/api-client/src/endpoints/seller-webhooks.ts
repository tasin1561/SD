/**
 * Seller outbound webhook endpoint configuration.
 *
 * Phase 1A scope is CRUD + secret rotation. The CREATE + ROTATE
 * responses include the plaintext `secretKey` (the only times it's
 * exposed by the server); LIST / GET responses omit it. The seller
 * UI must surface the secret to the user ONCE (copy-to-clipboard
 * pattern) on those two responses.
 */

export interface WebhookEndpointView {
  readonly id: string;
  readonly url: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly subscribedEvents: ReadonlyArray<string>;
  readonly isActive: boolean;
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
  readonly consecutiveFailureCount: number;
  readonly autoDisabledAt: string | null;
  readonly autoDisabledReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WebhookEndpointWithSecret extends WebhookEndpointView {
  readonly secretKey: string;
}

export interface CreateWebhookEndpointRequest {
  readonly url: string;
  readonly name?: string;
  readonly description?: string;
  readonly subscribedEvents: ReadonlyArray<string>;
  readonly isActive?: boolean;
}

export interface UpdateWebhookEndpointRequest {
  readonly url?: string;
  readonly name?: string;
  readonly description?: string;
  readonly subscribedEvents?: ReadonlyArray<string>;
  readonly isActive?: boolean;
}
