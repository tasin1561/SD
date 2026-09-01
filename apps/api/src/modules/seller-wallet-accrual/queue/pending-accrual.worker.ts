import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { PendingAccrualSweepService } from '../services/pending-accrual-sweep.service';
import { JOB_SWEEP_PENDING_ACCRUALS, PENDING_ACCRUAL_QUEUE_NAME } from './pending-accrual.queue';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';

/**
 * In-process worker for the hourly pending-accrual sweep cron (same
 * Phase 1A pattern as the reservation / email / image workers).
 * Idempotent: `PendingAccrualSweepService.sweep()` calls into
 * `AccrualExecutionService`, which no-ops on already-credited/debited
 * orders, so a re-delivered job cannot double-accrue.
 */
@Injectable()
export class PendingAccrualWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PendingAccrualWorker.name);
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly sweep: PendingAccrualSweepService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  onModuleInit(): void {
    // Only the queue-owning instance starts workers; every other
    // API instance serves HTTP only. See WorkerRoleService.
    if (!this.workerRole.shouldStart(PendingAccrualWorker.name)) return;
    this.worker = new Worker(
      PENDING_ACCRUAL_QUEUE_NAME,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_SWEEP_PENDING_ACCRUALS) {
          const result = await this.sweep.sweep();
          this.logger.log(result, 'Pending accrual sweep complete');
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown pending-accrual job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      // Only once BullMQ has stopped retrying: an exhausted job is
      // work that definitively did not happen.
      void this.issues.reportJobFailure(PendingAccrualWorker.name, job, err);
      this.logger.warn(
        { jobId: job?.id, name: job?.name, err: err?.message },
        'Pending accrual job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      // Say it where somebody will see it: a worker erroring
      // breaks no screen, the work simply stops happening.
      void this.issues.reportWorkerError(PendingAccrualWorker.name, err);
      this.logger.error({ err: err.message }, 'Pending accrual worker error');
    });
    this.logger.log(`Pending accrual worker ready (queue=${PENDING_ACCRUAL_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
