import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export const PENDING_ACCRUAL_QUEUE_NAME = 'wallet-pending-accrual';
export const JOB_SWEEP_PENDING_ACCRUALS = 'sweep-pending-accruals';
/** Top of every hour — mirrors the reservation auto-release cadence. */
export const PENDING_ACCRUAL_SWEEP_CRON = '0 * * * *';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 100 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 1_000 },
};

/**
 * R2b — hourly cron that drives `PendingAccrualSweepService.sweep()`
 * (same pattern as `ReservationQueue`).
 */
@Injectable()
export class PendingAccrualQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PendingAccrualQueue.name);
  private queue!: Queue;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(PENDING_ACCRUAL_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    // Stable jobId => re-registering on every boot is idempotent
    // (BullMQ dedupes the repeat schedule by key).
    await this.queue.add(
      JOB_SWEEP_PENDING_ACCRUALS,
      {},
      {
        repeat: { pattern: PENDING_ACCRUAL_SWEEP_CRON },
        jobId: 'wallet-pending-accrual-sweep',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );
    this.logger.log(
      `Pending accrual queue ready (name=${PENDING_ACCRUAL_QUEUE_NAME}); sweep cron=${PENDING_ACCRUAL_SWEEP_CRON}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }
}
