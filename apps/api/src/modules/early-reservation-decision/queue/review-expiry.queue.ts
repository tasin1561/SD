import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export const REVIEW_EXPIRY_QUEUE_NAME = 'early-reservation-review-expiry';
export const JOB_SWEEP_REVIEWS = 'sweep-expired-reviews';
/** Top of every hour — same cadence as the reservation + accrual sweeps. */
export const REVIEW_EXPIRY_CRON = '0 * * * *';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 100 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 1_000 },
};

/**
 * R5b — hourly cron driving `ReviewExpirySweepService.sweep()`, so an
 * unanswered seller review cannot hold stock indefinitely.
 */
@Injectable()
export class ReviewExpiryQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReviewExpiryQueue.name);
  private queue!: Queue;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(REVIEW_EXPIRY_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    // Stable jobId ⇒ re-registering on every boot is idempotent.
    await this.queue.add(
      JOB_SWEEP_REVIEWS,
      {},
      {
        repeat: { pattern: REVIEW_EXPIRY_CRON },
        jobId: 'early-reservation-review-expiry-sweep',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );
    this.logger.log(
      `Review expiry queue ready (name=${REVIEW_EXPIRY_QUEUE_NAME}); cron=${REVIEW_EXPIRY_CRON}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }
}
