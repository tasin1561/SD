import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import type { OrderCsvField } from '../order-csv-fields';

export const ORDER_CSV_IMPORT_QUEUE_NAME = 'order-csv-import';
export const JOB_PROCESS_ORDER_CSV = 'process-order-csv';

export interface ProcessOrderCsvJob {
  uploadId: string;
  /** Resolved field→header map (auto-detect + override) carried in the
   *  payload so a worker restart re-reads it intact. */
  mapping: Partial<Record<OrderCsvField, string>>;
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 500 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 2_000 },
};

@Injectable()
export class OrderCsvImportQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderCsvImportQueue.name);
  private queue!: Queue<ProcessOrderCsvJob>;

  constructor(private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<ProcessOrderCsvJob>(ORDER_CSV_IMPORT_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    this.logger.log(`Order CSV import queue ready (name=${ORDER_CSV_IMPORT_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }

  async enqueueProcess(data: ProcessOrderCsvJob): Promise<string> {
    const job = await this.queue.add(JOB_PROCESS_ORDER_CSV, data);
    return String(job.id);
  }
}
