import type { WebhookDeliveryStatus } from '@skydrop/db';

export interface WebhookDeliveryView {
  readonly id: string;
  readonly endpointId: string;
  readonly endpointUrl: string;
  readonly sellerId: string;
  readonly sellerCompany: string;
  readonly eventType: string;
  readonly eventId: string;
  readonly attemptNumber: number;
  readonly maxAttempts: number;
  readonly status: WebhookDeliveryStatus;
  readonly responseStatus: number | null;
  readonly responseTimeMs: number | null;
  readonly errorCode: string | null;
  readonly sentAt: string | null;
  readonly createdAt: string;
}

export interface WebhookDeliveryListResponse {
  readonly items: ReadonlyArray<WebhookDeliveryView>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface RetryWebhookDeliveryResponse {
  readonly jobId: string;
  readonly status: 'enqueued';
}
