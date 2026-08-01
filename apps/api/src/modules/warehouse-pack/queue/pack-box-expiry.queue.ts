import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export const PACK_BOX_EXPIRY_QUEUE_NAME = 'warehouse-pack-box-expiry';
export const JOB_SWEEP_PACK_BOXES = 'sweep-overdue-pack-boxes';
/**
 * Every five minutes, not hourly.
 *
 * The other sweeps in this codebase reclaim a soft hold — a stock
 * reservation, an unanswered review — where an hour of drift costs
 * nothing. This one reclaims a PARCEL that a packer is blocked from
 * touching: while a stale box is open, nobody can pack that order and
 * the packer who owns it cannot start another. An hour of that is an
 * hour of a bench standing idle.
 */
export const PACK_BOX_EXPIRY_CRON = '*/5 * * * *';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 100 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 1_000 },
};

/** Drives `PackBoxService.expireOverdue()` so a box abandoned at the end
 *  of a shift cannot wedge an order or its packer. */
@Injectable()
export class PackBoxExpiryQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PackBoxExpiryQueue.name);
  private queue!: Queue;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(PACK_BOX_EXPIRY_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    // Stable jobId ⇒ re-registering on every boot is idempotent.
    await this.queue.add(
      JOB_SWEEP_PACK_BOXES,
      {},
      {
        repeat: { pattern: PACK_BOX_EXPIRY_CRON },
        jobId: 'warehouse-pack-box-expiry-sweep',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );
    this.logger.log(
      `Pack-box expiry queue ready (name=${PACK_BOX_EXPIRY_QUEUE_NAME}); cron=${PACK_BOX_EXPIRY_CRON}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }
}
