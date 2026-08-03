import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export const WEBHOOK_RETENTION_QUEUE_NAME = 'tracking-webhook-retention';
export const JOB_SWEEP_WEBHOOK_PAYLOADS = 'sweep-webhook-payloads';
/** 03:20 daily — off the hour, so it does not start alongside every
 *  other sweep, and in the quietest part of the Indian delivery day. */
export const WEBHOOK_RETENTION_CRON = '20 3 * * *';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 50 },
  removeOnFail: { age: 30 * 24 * 60 * 60, count: 200 },
};

/**
 * Daily cron behind `WebhookPayloadRetentionService.sweep()`.
 *
 * Daily rather than hourly: the thing it reclaims accumulates over
 * months, so running it twenty-four times a day would be twenty-three
 * empty queries and one useful one.
 */
@Injectable()
export class WebhookRetentionQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookRetentionQueue.name);
  private queue!: Queue;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(WEBHOOK_RETENTION_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    // Stable jobId ⇒ re-registering on every boot is idempotent, and so
    // is a second API instance registering the same repeatable job.
    await this.queue.add(
      JOB_SWEEP_WEBHOOK_PAYLOADS,
      {},
      {
        repeat: { pattern: WEBHOOK_RETENTION_CRON },
        jobId: 'tracking-webhook-retention-sweep',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );
    this.logger.log(
      `Webhook retention queue ready (name=${WEBHOOK_RETENTION_QUEUE_NAME}); cron=${WEBHOOK_RETENTION_CRON}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }
}
