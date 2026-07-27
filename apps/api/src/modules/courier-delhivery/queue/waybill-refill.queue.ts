import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export const WAYBILL_REFILL_QUEUE_NAME = 'courier-waybill-refill';
export const JOB_REFILL_WAYBILLS = 'refill-waybill-pool';
/**
 * Every 15 minutes. Delhivery allows five bulk fetches per five minutes,
 * so this cadence stays far inside the budget while still topping up
 * several times an hour — and each refill pulls a large batch precisely
 * because requests, not numbers, are the scarce resource.
 */
export const WAYBILL_REFILL_CRON = '*/15 * * * *';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 100 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 1_000 },
};

@Injectable()
export class WaybillRefillQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WaybillRefillQueue.name);
  private queue!: Queue;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(WAYBILL_REFILL_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    await this.queue.add(
      JOB_REFILL_WAYBILLS,
      {},
      {
        repeat: { pattern: WAYBILL_REFILL_CRON },
        jobId: 'courier-waybill-refill',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );
    this.logger.log(
      `Waybill refill queue ready (name=${WAYBILL_REFILL_QUEUE_NAME}); cron=${WAYBILL_REFILL_CRON}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }
}
