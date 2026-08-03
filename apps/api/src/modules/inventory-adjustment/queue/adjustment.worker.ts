import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { ActorType } from '@skydrop/db';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { StockAdjustmentService } from '../services/stock-adjustment.service';
import {
  ADJUSTMENT_QUEUE_NAME,
  JOB_EXECUTE_ADJUSTMENT,
  type ExecuteAdjustmentJob,
} from './adjustment.queue';

/**
 * In-process executor for APPROVED adjustments (same Phase 1A pattern as
 * the email/image/reservation workers). executeAdjustment is idempotent
 * (an already-EXECUTED adjustment is a no-op), so a BullMQ retry after a
 * partial-failure rollback is safe — the adjustment stays APPROVED and
 * the whole line set is re-applied atomically next attempt.
 */
@Injectable()
export class AdjustmentWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdjustmentWorker.name);
  private worker!: Worker<ExecuteAdjustmentJob>;

  constructor(
    private readonly redis: RedisService,
    private readonly adjustments: StockAdjustmentService,
    private readonly workerRole: WorkerRoleService,
  ) {}

  onModuleInit(): void {
    // Only the queue-owning instance starts workers; every other
    // API instance serves HTTP only. See WorkerRoleService.
    if (!this.workerRole.shouldStart(AdjustmentWorker.name)) return;
    this.worker = new Worker<ExecuteAdjustmentJob>(
      ADJUSTMENT_QUEUE_NAME,
      async (job: Job<ExecuteAdjustmentJob>): Promise<void> => {
        if (job.name !== JOB_EXECUTE_ADJUSTMENT) {
          this.logger.warn({ name: job.name }, 'Unknown adjustment job; ignoring');
          return;
        }
        const { adjustmentId } = job.data;
        await this.adjustments.executeAdjustment(adjustmentId, { type: ActorType.SYSTEM });
        this.logger.log({ adjustmentId }, 'Adjustment executed by worker');
      },
      { connection: this.redis.createConnection(), concurrency: 2 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { jobId: job?.id, err: err?.message },
        'Adjustment execution failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      this.logger.error({ err: err.message }, 'Adjustment worker error');
    });
    this.logger.log(`Adjustment worker ready (queue=${ADJUSTMENT_QUEUE_NAME}, concurrency=2)`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
