import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export const ADJUSTMENT_QUEUE_NAME = 'inventory-adjustment';
export const JOB_EXECUTE_ADJUSTMENT = 'execute-adjustment';

export interface ExecuteAdjustmentJob {
  adjustmentId: string;
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
};

@Injectable()
export class AdjustmentQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdjustmentQueue.name);
  private queue!: Queue<ExecuteAdjustmentJob>;

  constructor(private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<ExecuteAdjustmentJob>(ADJUSTMENT_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    this.logger.log(`Adjustment queue ready (name=${ADJUSTMENT_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }

  /** Enqueued by approve(); the worker runs executeAdjustment in its own
   *  tx. Dedup by adjustmentId so a double-approve cannot double-enqueue. */
  async enqueueExecute(adjustmentId: string): Promise<string> {
    const job = await this.queue.add(
      JOB_EXECUTE_ADJUSTMENT,
      { adjustmentId },
      { jobId: `adj-exec-${adjustmentId}` },
    );
    return String(job.id);
  }
}
