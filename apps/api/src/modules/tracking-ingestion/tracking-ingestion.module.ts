import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { ConfigModule } from '../../config/config.module';
import { WebhookAuthService } from './services/webhook-auth.service';

/**
 * Module 10 — tracking-ingestion (commit 4 skeleton).
 *
 * Scope (built incrementally over M10 commits 4-9):
 *   - WebhookAuthService — HMAC verification (commit 4, this commit)
 *   - WebhookIngestService + public webhook controller — authenticate→
 *     store (raw inbound ledger, TRK-1/2) + fast 200 ack + BullMQ
 *     enqueue (commit 5)
 *   - Webhook processor + worker — normalize → append tracking_event
 *     (via tracking-events) → map → transition via OrderWriteService,
 *     monotonic-forward guard (TRK-4); FAILED_ATTEMPT writes
 *     delivery_attempts (commit 8)
 *   - The matrix wire-up for DELIVERED / RTO_INITIATED /
 *     RTO_IN_TRANSIT transitions (commit 9; RTO_DELIVERED stays
 *     informational per TRK-6, DELIVERED stays stock-neutral per
 *     TRK-7)
 *
 * Exports NOTHING externally — a leaf consumer module (mirrors the
 * warehouse-* modules). The public controller it owns is its only
 * surface.
 */
@Module({
  imports: [PrismaModule, ConfigModule],
  providers: [WebhookAuthService],
  exports: [],
})
export class TrackingIngestionModule {}
