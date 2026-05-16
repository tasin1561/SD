import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import type { CsvTargetField } from '../csv-fields';

export const CSV_IMPORT_QUEUE_NAME = 'catalog-csv-import';
export const JOB_PROCESS_CSV = 'process-csv';

export interface ProcessCsvJob {
  uploadId: string;
  /** Resolved field→header map (auto-detect + seller override) carried
   *  in the payload so a worker restart re-reads it intact. */
  mapping: Partial<Record<CsvTargetField, string>>;
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 500 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 2_000 },
};

@Injectable()
export class CsvImportQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CsvImportQueue.name);
  private queue!: Queue<ProcessCsvJob>;

  constructor(private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<ProcessCsvJob>(CSV_IMPORT_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    this.logger.log(`CSV import queue ready (name=${CSV_IMPORT_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }

  async enqueueProcess(data: ProcessCsvJob): Promise<string> {
    const job = await this.queue.add(JOB_PROCESS_CSV, data);
    return String(job.id);
  }
}
