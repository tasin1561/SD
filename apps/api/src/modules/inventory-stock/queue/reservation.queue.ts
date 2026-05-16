import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export const RESERVATION_QUEUE_NAME = 'inventory-reservation';
export const JOB_AUTO_RELEASE = 'auto-release-expired';
/** Top of every hour. */
export const AUTO_RELEASE_CRON = '0 * * * *';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 100 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 1_000 },
};

@Injectable()
export class ReservationQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReservationQueue.name);
  private queue!: Queue;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(RESERVATION_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    // Stable jobId => re-registering on every boot is idempotent (BullMQ
    // dedupes the repeat schedule by key), same as the image cron.
    await this.queue.add(
      JOB_AUTO_RELEASE,
      {},
      {
        repeat: { pattern: AUTO_RELEASE_CRON },
        jobId: 'reservation-auto-release',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );
    this.logger.log(
      `Reservation queue ready (name=${RESERVATION_QUEUE_NAME}); auto-release cron=${AUTO_RELEASE_CRON}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }
}
