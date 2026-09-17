import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { StoreRequestExpiryService } from '../services/store-request-expiry.service';
import {
  JOB_SWEEP_STORE_REQUESTS,
  STORE_REQUEST_EXPIRY_QUEUE_NAME,
} from './store-request-expiry.queue';

/**
 * In-process worker for the store-request reminder/expiry sweep. Every
 * move the sweep makes is a guarded claim, so a re-delivered job cannot
 * remind twice or expire twice.
 */
@Injectable()
export class StoreRequestExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StoreRequestExpiryWorker.name);
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly sweep: StoreRequestExpiryService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  onModuleInit(): void {
    // SCALE-1: only the queue-owning instance starts workers.
    if (!this.workerRole.shouldStart(StoreRequestExpiryWorker.name)) return;
    this.worker = new Worker(
      STORE_REQUEST_EXPIRY_QUEUE_NAME,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_SWEEP_STORE_REQUESTS) {
          const result = await this.sweep.sweep();
          if (result.reminded > 0 || result.expired > 0 || result.failures > 0) {
            this.logger.log(result, 'Store request reminder/expiry sweep complete');
          }
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown store-request-expiry job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      void this.issues.reportJobFailure(StoreRequestExpiryWorker.name, job, err);
      this.logger.warn(
        { jobId: job?.id, name: job?.name, err: err?.message },
        'Store request expiry job failed',
      );
    });
    this.worker.on('error', (err) => {
      void this.issues.reportWorkerError(StoreRequestExpiryWorker.name, err);
      this.logger.error({ err: err.message }, 'Store request expiry worker error');
    });
    this.logger.log(`Store request expiry worker ready (queue=${STORE_REQUEST_EXPIRY_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
