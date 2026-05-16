import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { CsvImportProcessorService } from '../services/csv-import-processor.service';
import {
  CSV_IMPORT_QUEUE_NAME,
  JOB_PROCESS_CSV,
  type ProcessCsvJob,
} from './csv-import.queue';

/**
 * In-process CSV import worker (Phase 1A pattern). Delegates to
 * CsvImportProcessorService, which is itself terminal-state idempotent
 * (a re-delivered job for an already COMPLETED upload is a no-op).
 */
@Injectable()
export class CsvImportWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CsvImportWorker.name);
  private worker!: Worker<ProcessCsvJob>;

  constructor(
    private readonly redis: RedisService,
    private readonly processor: CsvImportProcessorService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<ProcessCsvJob>(
      CSV_IMPORT_QUEUE_NAME,
      async (job: Job<ProcessCsvJob>): Promise<void> => {
        if (job.name === JOB_PROCESS_CSV) {
          await this.processor.process(job.data.uploadId, job.data.mapping);
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown csv-import job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { jobId: job?.id, err: err?.message },
        'CSV import job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      this.logger.error({ err: err.message }, 'CSV import worker error');
    });
    this.logger.log(`CSV import worker ready (queue=${CSV_IMPORT_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
