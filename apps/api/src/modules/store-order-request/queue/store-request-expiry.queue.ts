import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export const STORE_REQUEST_EXPIRY_QUEUE_NAME = 'store-request-expiry';
export const JOB_SWEEP_STORE_REQUESTS = 'sweep-store-requests';
/** Every 15 minutes: the tick decides only how far past a threshold a request goes. */
export const STORE_REQUEST_EXPIRY_CRON = '*/15 * * * *';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 100 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 1_000 },
};

/**
 * 2026-09-17 — the repeatable job that reminds seller staff about, and
 * finally expires, a reseller store's request nobody answered.
 */
@Injectable()
export class StoreRequestExpiryQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StoreRequestExpiryQueue.name);
  private queue!: Queue;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(STORE_REQUEST_EXPIRY_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    // Stable jobId ⇒ re-registering on every boot is idempotent.
    await this.queue.add(
      JOB_SWEEP_STORE_REQUESTS,
      {},
      {
        repeat: { pattern: STORE_REQUEST_EXPIRY_CRON },
        jobId: 'store-request-expiry-sweep',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );
    this.logger.log(
      `Store request expiry queue ready (name=${STORE_REQUEST_EXPIRY_QUEUE_NAME}); cron=${STORE_REQUEST_EXPIRY_CRON}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }
}
