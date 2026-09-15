import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export const RESELLER_MONEY_QUEUE_NAME = 'reseller-order-money';
export const JOB_SWEEP_RESELLER_CREDITS = 'sweep-reseller-credits';
/**
 * Every 15 minutes: the tick only decides how far past its due time a
 * credit runs (AFTER_DELIVERY N days, ON_PAYOUT +N, AFTER_CONFIRMATION N),
 * and a credit due at once is written by the event that armed it.
 */
export const RESELLER_MONEY_SWEEP_CRON = '*/15 * * * *';

/** RS-6 phase 3c — the cron that writes reseller order credits as they come due. */
@Injectable()
export class ResellerMoneyQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResellerMoneyQueue.name);
  private queue!: Queue;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(RESELLER_MONEY_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 24 * 60 * 60, count: 100 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 1_000 },
      },
    });
    await this.queue.add(
      JOB_SWEEP_RESELLER_CREDITS,
      {},
      {
        repeat: { pattern: RESELLER_MONEY_SWEEP_CRON },
        jobId: 'reseller-order-money-sweep',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );
    this.logger.log(
      `Reseller money queue ready (name=${RESELLER_MONEY_QUEUE_NAME}); sweep cron=${RESELLER_MONEY_SWEEP_CRON}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }
}
