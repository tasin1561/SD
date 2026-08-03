import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { WebhookProcessorService } from '../services/webhook-processor.service';
import {
  JOB_PROCESS_WEBHOOK,
  TRACKING_WEBHOOK_BACKOFF_STRATEGY,
  TRACKING_WEBHOOK_QUEUE_NAME,
  TrackingWebhookQueue,
  type ProcessWebhookJob,
} from './tracking-webhook.queue';

/**
 * Module 10 — in-process BullMQ worker for tracking-webhook processing
 * (M10 commit 8). Mirrors the M9 AwbGenerationWorker shape:
 *
 *   - delegates each job to `WebhookProcessorService.process(webhookId)`,
 *     which is idempotent (TRK-2 master gate + per-side-effect dedup);
 *   - the custom `tracking-webhook-per-attempt` backoff strategy maps
 *     BullMQ's `attemptsMade` onto the `courier.awb_job_retry_backoff_ms`
 *     array (shared with M9 — no new system_settings key for a mirror
 *     cadence);
 *   - per-attempt failures are logged and re-thrown so BullMQ schedules
 *     the next attempt. After the configured max-attempts the job
 *     lands FAILED and ops manually re-trigger via `process(webhookId)`
 *     (the method is intentionally public).
 *
 * Concurrency is 1 — Phase 1A volume is low and serial processing
 * keeps the per-shipment monotonic-forward + advisory-lock paths
 * simple. Revisit (per-shipment partitioning) if Phase 1B scales.
 */
@Injectable()
export class TrackingWebhookWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackingWebhookWorker.name);
  private worker!: Worker<ProcessWebhookJob>;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly processor: WebhookProcessorService,
    private readonly workerRole: WorkerRoleService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Only the queue-owning instance starts workers; every other
    // API instance serves HTTP only. See WorkerRoleService.
    if (!this.workerRole.shouldStart(TrackingWebhookWorker.name)) return;
    const backoffMs = await TrackingWebhookQueue.resolveBackoffMs(this.prisma);

    this.worker = new Worker<ProcessWebhookJob>(
      TRACKING_WEBHOOK_QUEUE_NAME,
      async (job: Job<ProcessWebhookJob>): Promise<void> => {
        if (job.name === JOB_PROCESS_WEBHOOK) {
          await this.processor.process(job.data.webhookId);
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown tracking-webhook job; ignoring');
      },
      {
        connection: this.redis.createConnection(),
        concurrency: 1,
        settings: {
          backoffStrategy: (attemptsMade: number): number => {
            const idx = Math.min(Math.max(attemptsMade - 1, 0), backoffMs.length - 1);
            return backoffMs[idx] ?? 1000;
          },
        },
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { jobId: job?.id, err: err?.message },
        'tracking-webhook job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      this.logger.error({ err: err.message }, 'tracking-webhook worker error');
    });
    this.logger.log(
      `tracking-webhook worker ready (queue=${TRACKING_WEBHOOK_QUEUE_NAME}, backoff=${TRACKING_WEBHOOK_BACKOFF_STRATEGY})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
