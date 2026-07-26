import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { PendingAccrualSweepService } from '../services/pending-accrual-sweep.service';
import { JOB_SWEEP_PENDING_ACCRUALS, PENDING_ACCRUAL_QUEUE_NAME } from './pending-accrual.queue';

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
  ) {}

  onModuleInit(): void {
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
      this.logger.warn(
        { jobId: job?.id, name: job?.name, err: err?.message },
        'Pending accrual job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      this.logger.error({ err: err.message }, 'Pending accrual worker error');
    });
    this.logger.log(`Pending accrual worker ready (queue=${PENDING_ACCRUAL_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
