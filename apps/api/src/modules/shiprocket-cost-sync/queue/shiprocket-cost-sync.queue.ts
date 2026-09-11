import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export const SHIPROCKET_COST_QUEUE = 'shiprocket-cost-sync';
export const JOB_SHIPROCKET_COST = 'sync-shiprocket-cost';
/** Nightly, after the Delhivery sync (21:10) has finished with its own run. */
export const SHIPROCKET_COST_CRON = '40 21 * * *';
export const SHIPROCKET_COST_TZ = 'Asia/Kolkata';

/**
 * The nightly Shiprocket cost sync, and the "run it now" button.
 *
 * In the API process, not the portal worker: Shiprocket answers per order
 * over plain HTTP, so there is no browser to keep away from customer
 * traffic. ONE attempt per run, as the Delhivery sync: a retry loop
 * against a courier's API is how an account gets rate-limited, and the
 * next night re-reads everything anyway.
 */
@Injectable()
export class ShiprocketCostSyncQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ShiprocketCostSyncQueue.name);
  private queue!: Queue;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(SHIPROCKET_COST_QUEUE, {
      connection: this.redis.createConnection(),
      defaultJobOptions: {
        removeOnComplete: { age: 14 * 24 * 60 * 60, count: 30 },
        removeOnFail: { age: 30 * 24 * 60 * 60, count: 60 },
      },
    });
    await this.queue.add(
      JOB_SHIPROCKET_COST,
      { manual: false },
      {
        repeat: { pattern: SHIPROCKET_COST_CRON, tz: SHIPROCKET_COST_TZ },
        jobId: 'shiprocket-cost-sync-cron',
        attempts: 1,
      },
    );
    this.logger.log(
      `shiprocket-cost-sync queue ready (cron=${SHIPROCKET_COST_CRON} ${SHIPROCKET_COST_TZ})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }

  /** Queued, not finished — the run appears in the history when it lands. */
  async requestRun(): Promise<{ readonly queued: boolean; readonly jobId: string | null }> {
    const job = await this.queue.add(JOB_SHIPROCKET_COST, { manual: true }, { attempts: 1 });
    return { queued: true, jobId: job.id ?? null };
  }
}
