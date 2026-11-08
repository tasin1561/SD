import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export const CONFIRMATION_TTL_QUEUE_NAME = 'order-confirmation-ttl';
export const JOB_SWEEP_CONFIRMATION_TTL = 'sweep-confirmation-ttl';

/** Every minute: the TTL is measured in hours, so a minute of lag is invisible. */
export const CONFIRMATION_TTL_CRON = '* * * * *';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 60 * 60, count: 100 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 500 },
};

/** Producer half of the no-call TTL auto-confirm sweep; the worker consumes it. */
@Injectable()
export class ConfirmationTtlQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConfirmationTtlQueue.name);
  private queue!: Queue;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(CONFIRMATION_TTL_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    // Stable jobId ⇒ re-registering on every boot is idempotent.
    await this.queue.add(
      JOB_SWEEP_CONFIRMATION_TTL,
      {},
      {
        repeat: { pattern: CONFIRMATION_TTL_CRON },
        jobId: 'order-confirmation-ttl-sweep',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );
    this.logger.log(`Confirmation-TTL sweep scheduled; cron=${CONFIRMATION_TTL_CRON}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }
}
