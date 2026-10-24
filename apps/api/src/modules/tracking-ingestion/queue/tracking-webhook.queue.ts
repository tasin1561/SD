import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export const TRACKING_WEBHOOK_QUEUE_NAME = 'tracking-webhook-processing';
export const JOB_PROCESS_WEBHOOK = 'process-webhook';
export const TRACKING_WEBHOOK_BACKOFF_STRATEGY = 'tracking-webhook-per-attempt';

export interface ProcessWebhookJob {
  /** courier_webhooks.id — the persisted raw inbound ledger row. */
  webhookId: string;
}

/** Fallbacks when the tracking.webhook_processing_retry_max setting is absent. */
const DEFAULT_RETRY_MAX = 3;
const DEFAULT_BACKOFF_MS: readonly number[] = [1000, 5000, 15000];
const RETRY_MAX_KEY = 'tracking.webhook_processing_retry_max';

/**
 * Module 10 — per-webhook processing BullMQ queue (TRK-1/2). Retry
 * config is data-driven from system_settings:
 *   - attempts ← tracking.webhook_processing_retry_max (seeded 3)
 *   - per-attempt backoff ← courier.awb_job_retry_backoff_ms shape
 *     (reused — same fallback array, no new setting key for a
 *     mirror configuration; revisit if M11 wants distinct cadences)
 *
 * jobId = webhookId — deterministic, so a duplicate enqueue (a
 * controller-level retry mid-write, a BullMQ re-delivery while the
 * worker is processing) collapses to ONE job. The processor (commit 8)
 * is itself idempotent on the courier_webhooks row's `status` field
 * (TRK-2), so retries are correct end-to-end.
 *
 * NOTE: the WORKER lands in M10 commit 8. Until then enqueued jobs
 * accumulate in Redis (visible in monitoring; not lost). This is the
 * same staged shape M9 used (queue infra commit, worker commit) — the
 * controller path stays incremental + reviewable.
 */
@Injectable()
export class TrackingWebhookQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackingWebhookQueue.name);
  private queue!: Queue<ProcessWebhookJob>;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    const attempts = await this.retryMax();
    const defaultJobOptions: JobsOptions = {
      attempts,
      backoff: { type: TRACKING_WEBHOOK_BACKOFF_STRATEGY },
      removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
    };
    this.queue = new Queue<ProcessWebhookJob>(TRACKING_WEBHOOK_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions,
    });
    this.logger.log(
      `tracking-webhook queue ready (name=${TRACKING_WEBHOOK_QUEUE_NAME}, attempts=${attempts})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }

  /** Enqueue a stored webhook for processing. jobId = webhookId (dedup). */
  async enqueueWebhook(webhookId: string): Promise<string> {
    const job = await this.queue.add(JOB_PROCESS_WEBHOOK, { webhookId }, { jobId: webhookId });
    return String(job.id);
  }

  /**
   * Re-enqueue a stored webhook for a SECOND pass, by hand (TRK-11).
   *
   * `enqueueWebhook` CANNOT do this, and the way it fails is the reason
   * this method exists: `jobId = webhookId` is the dedup key, and BullMQ
   * answers an `add` whose jobId already exists by returning the OLD job
   * without scheduling anything — silently, with a job id that looks
   * exactly like success. That is the worst possible shape for a
   * recovery lever, so the finished job is removed first and the id is
   * free to be used again.
   *
   * A job that is still waiting, delayed or running is NOT disturbed:
   * it is already going to do the work, and removing a locked job
   * throws. Its id comes back instead, so a second press is a no-op
   * rather than an error or a duplicate.
   *
   * This is only ever reached from an explicitly-invoked admin endpoint.
   * TRK-11 forbids re-queueing on a timer — "one bad body becomes a job
   * that fails for ever" — and that rule is about the WATCHDOG, which
   * still only names the rows and stops. A person deciding is the
   * sanctioned path, and the thing the worker's own comment assumed
   * existed.
   */
  async replayWebhook(webhookId: string): Promise<{ jobId: string; alreadyQueued: boolean }> {
    const existing = await this.queue.getJob(webhookId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'active' || state === 'waiting' || state === 'delayed') {
        return { jobId: String(existing.id), alreadyQueued: true };
      }
      await existing.remove();
    }
    return { jobId: await this.enqueueWebhook(webhookId), alreadyQueued: false };
  }

  private async retryMax(): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: RETRY_MAX_KEY },
      select: { valueInt: true },
    });
    const v = row?.valueInt;
    return typeof v === 'number' && v >= 1 ? v : DEFAULT_RETRY_MAX;
  }

  /** Per-attempt backoff array (ms) — read by the worker (commit 8)
   *  to register the custom backoff strategy. */
  static async resolveBackoffMs(prisma: PrismaService): Promise<number[]> {
    const row = await prisma.client.systemSetting.findUnique({
      where: { key: 'courier.awb_job_retry_backoff_ms' },
      select: { valueJson: true },
    });
    const raw = row?.valueJson;
    if (Array.isArray(raw) && raw.length > 0 && raw.every((n) => typeof n === 'number' && n >= 0)) {
      return raw as number[];
    }
    return [...DEFAULT_BACKOFF_MS];
  }
}
