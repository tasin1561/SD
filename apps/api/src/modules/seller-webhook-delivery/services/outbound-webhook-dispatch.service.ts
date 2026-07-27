import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { OutboundWebhookJobInput, WebhookSendResult } from '../types';

/**
 * The actual HTTP I/O step + persistence of the OutboundWebhookDelivery
 * row + the endpoint-side bookkeeping (last success/failure,
 * consecutiveFailureCount, auto-disable on threshold).
 *
 * Idempotency note: BullMQ retries call this method with the SAME
 * `attemptNumber` on the same job instance (we drive attempt count
 * via job.attemptsMade externally), so the unique key on
 * OutboundWebhookDelivery is `(endpointId, eventType, eventId,
 * attemptNumber)` per CLAUDE.md. We persist BEFORE the HTTP fire
 * (sets row.status=IN_FLIGHT), then UPDATE the same row on outcome
 * (DELIVERED / FAILED).
 */
@Injectable()
export class OutboundWebhookDispatchService {
  private readonly logger = new Logger(OutboundWebhookDispatchService.name);

  /** Default ceiling for `consecutiveFailureCount` before auto-disable.
   *  CLAUDE.md says configurable via system_settings; for Phase 1A
   *  we read it from env with a 50 default. */
  private static readonly AUTO_DISABLE_THRESHOLD = Number(
    process.env.WEBHOOK_AUTO_DISABLE_THRESHOLD ?? '50',
  );

  /** HTTP timeout. 30s is generous for receiving systems; sellers
   *  with slow integration backends are expected to write to a
   *  queue + return 2xx immediately. */
  private static readonly HTTP_TIMEOUT_MS = 30_000;

  constructor(private readonly prisma: PrismaService) {}

  async deliver(input: OutboundWebhookJobInput): Promise<WebhookSendResult> {
    const body = JSON.stringify(input.payload);
    const headers = {
      'Content-Type': 'application/json',
      'X-Skydrop-Signature': `sha256=${input.signature}`,
      'X-Skydrop-Event': input.eventType,
      'X-Skydrop-Event-Id': input.eventId,
      'X-Skydrop-Delivery-Attempt': String(input.attemptNumber),
      'User-Agent': 'Skydrop-Webhooks/1.0',
    };

    // CREATE / UPDATE the delivery row pre-fire so a process crash
    // mid-fire leaves a visible IN_FLIGHT row (recoverable via
    // observability — Phase 1B reconciler).
    const created = await this.prisma.client.outboundWebhookDelivery.upsert({
      where: {
        endpointId_eventType_eventId_attemptNumber: {
          endpointId: input.endpointId,
          eventType: input.eventType,
          eventId: input.eventId,
          attemptNumber: input.attemptNumber,
        },
      },
      create: {
        endpointId: input.endpointId,
        eventType: input.eventType,
        eventId: input.eventId,
        payload: input.payload as never,
        payloadVersion: 'v1',
        attemptNumber: input.attemptNumber,
        maxAttempts: 5,
        httpMethod: 'POST',
        requestUrl: input.requestUrl,
        requestHeaders: headers as never,
        signature: input.signature,
        status: 'IN_FLIGHT',
      },
      update: { status: 'IN_FLIGHT', sentAt: null },
    });

    // ── Fire ─────────────────────────────────────────────────────────
    const startedAt = Date.now();
    let result: WebhookSendResult;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      OutboundWebhookDispatchService.HTTP_TIMEOUT_MS,
    );
    try {
      const res = await fetch(input.requestUrl, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      const responseTimeMs = Date.now() - startedAt;
      const responseBody = await res.text().catch(() => '');
      const trimmedBody = responseBody.slice(0, 4000); // cap stored body
      if (res.status >= 200 && res.status < 300) {
        result = {
          status: 'DELIVERED',
          httpStatus: res.status,
          responseTimeMs,
          errorCode: null,
          errorMessage: null,
          responseBody: trimmedBody || null,
        };
      } else {
        result = {
          status: 'FAILED',
          httpStatus: res.status,
          responseTimeMs,
          errorCode: `HTTP_${res.status}`,
          errorMessage: `Endpoint returned ${res.status}`,
          responseBody: trimmedBody || null,
        };
      }
    } catch (e) {
      const responseTimeMs = Date.now() - startedAt;
      const isAbort = (e as Error).name === 'AbortError';
      result = {
        status: 'FAILED',
        httpStatus: null,
        responseTimeMs,
        errorCode: isAbort ? 'TIMEOUT' : 'NETWORK_ERROR',
        errorMessage: (e as Error).message,
        responseBody: null,
      };
    } finally {
      clearTimeout(timer);
    }

    // ── Persist outcome ──────────────────────────────────────────────
    await this.prisma.client.outboundWebhookDelivery.update({
      where: { id: created.id },
      data: {
        status: result.status === 'DELIVERED' ? 'DELIVERED' : 'FAILED',
        sentAt: new Date(),
        responseStatus: result.httpStatus,
        responseTimeMs: result.responseTimeMs,
        responseBody: result.responseBody,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      },
    });

    // ── Endpoint bookkeeping + auto-disable ──────────────────────────
    if (result.status === 'DELIVERED') {
      await this.prisma.client.sellerWebhookEndpoint.update({
        where: { id: input.endpointId },
        data: {
          lastSuccessAt: new Date(),
          consecutiveFailureCount: 0,
        },
      });
    } else {
      // Atomic increment + read-back; if the new count crosses the
      // threshold, auto-disable in the same write.
      const updated = await this.prisma.client.sellerWebhookEndpoint.update({
        where: { id: input.endpointId },
        data: {
          lastFailureAt: new Date(),
          consecutiveFailureCount: { increment: 1 },
        },
        select: { consecutiveFailureCount: true, autoDisabledAt: true },
      });
      if (
        updated.autoDisabledAt === null &&
        updated.consecutiveFailureCount >= OutboundWebhookDispatchService.AUTO_DISABLE_THRESHOLD
      ) {
        await this.prisma.client.sellerWebhookEndpoint.update({
          where: { id: input.endpointId },
          data: {
            isActive: false,
            autoDisabledAt: new Date(),
            autoDisabledReason: `consecutive failures reached threshold (${OutboundWebhookDispatchService.AUTO_DISABLE_THRESHOLD})`,
          },
        });
        this.logger.warn(
          {
            endpointId: input.endpointId,
            threshold: OutboundWebhookDispatchService.AUTO_DISABLE_THRESHOLD,
          },
          'Webhook endpoint auto-disabled after consecutive-failure threshold reached',
        );
      }
    }

    return result;
  }
}
