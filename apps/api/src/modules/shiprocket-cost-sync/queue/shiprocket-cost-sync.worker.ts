import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { ShiprocketCostSyncService } from '../services/shiprocket-cost-sync.service';
import { JOB_SHIPROCKET_COST, SHIPROCKET_COST_QUEUE } from './shiprocket-cost-sync.queue';

@Injectable()
export class ShiprocketCostSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ShiprocketCostSyncWorker.name);
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly sync: ShiprocketCostSyncService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  onModuleInit(): void {
    // Only the queue-owning instance runs workers (SCALE-1); a second
    // one would read every parcel twice a night.
    if (!this.workerRole.shouldStart(ShiprocketCostSyncWorker.name)) return;
    this.worker = new Worker(
      SHIPROCKET_COST_QUEUE,
      async (job: Job<{ manual?: boolean }>): Promise<void> => {
        if (job.name !== JOB_SHIPROCKET_COST) {
          this.logger.warn({ name: job.name }, 'Unknown shiprocket-cost-sync job; ignoring');
          return;
        }
        await this.sync.sync(job.data.manual === true ? 'MANUAL' : 'SCHEDULE');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      void this.issues.reportJobFailure(ShiprocketCostSyncWorker.name, job, err);
      this.logger.warn({ jobId: job?.id, err: err?.message }, 'shiprocket-cost-sync job failed');
    });
    this.worker.on('error', (err) => {
      void this.issues.reportWorkerError(ShiprocketCostSyncWorker.name, err);
      this.logger.error({ err: err.message }, 'shiprocket-cost-sync worker error');
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
