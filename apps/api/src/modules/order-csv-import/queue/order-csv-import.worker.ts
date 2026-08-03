import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { OrderCsvImportProcessorService } from '../services/order-csv-import-processor.service';
import {
  JOB_PROCESS_ORDER_CSV,
  ORDER_CSV_IMPORT_QUEUE_NAME,
  type ProcessOrderCsvJob,
} from './order-csv-import.queue';

/**
 * In-process order CSV import worker (Phase 1A pattern). Delegates to
 * OrderCsvImportProcessorService, which is terminal-state idempotent
 * (a re-delivered job for an already COMPLETED upload is a no-op).
 */
@Injectable()
export class OrderCsvImportWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderCsvImportWorker.name);
  private worker!: Worker<ProcessOrderCsvJob>;

  constructor(
    private readonly redis: RedisService,
    private readonly processor: OrderCsvImportProcessorService,
    private readonly workerRole: WorkerRoleService,
  ) {}

  onModuleInit(): void {
    // Only the queue-owning instance starts workers; every other
    // API instance serves HTTP only. See WorkerRoleService.
    if (!this.workerRole.shouldStart(OrderCsvImportWorker.name)) return;
    this.worker = new Worker<ProcessOrderCsvJob>(
      ORDER_CSV_IMPORT_QUEUE_NAME,
      async (job: Job<ProcessOrderCsvJob>): Promise<void> => {
        if (job.name === JOB_PROCESS_ORDER_CSV) {
          await this.processor.process(job.data.uploadId, job.data.mapping);
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown order-csv-import job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { jobId: job?.id, err: err?.message },
        'Order CSV import job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      this.logger.error({ err: err.message }, 'Order CSV import worker error');
    });
    this.logger.log(`Order CSV import worker ready (queue=${ORDER_CSV_IMPORT_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
