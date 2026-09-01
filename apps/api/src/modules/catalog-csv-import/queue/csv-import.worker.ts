import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { CsvImportProcessorService } from '../services/csv-import-processor.service';
import { CSV_IMPORT_QUEUE_NAME, JOB_PROCESS_CSV, type ProcessCsvJob } from './csv-import.queue';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';

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
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  onModuleInit(): void {
    // Only the queue-owning instance starts workers; every other
    // API instance serves HTTP only. See WorkerRoleService.
    if (!this.workerRole.shouldStart(CsvImportWorker.name)) return;
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
      // Only once BullMQ has stopped retrying: an exhausted job is
      // work that definitively did not happen.
      void this.issues.reportJobFailure(CsvImportWorker.name, job, err);
      this.logger.warn(
        { jobId: job?.id, err: err?.message },
        'CSV import job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      // Say it where somebody will see it: a worker erroring
      // breaks no screen, the work simply stops happening.
      void this.issues.reportWorkerError(CsvImportWorker.name, err);
      this.logger.error({ err: err.message }, 'CSV import worker error');
    });
    this.logger.log(`CSV import worker ready (queue=${CSV_IMPORT_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
