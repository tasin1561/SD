import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { PackBoxService } from '../services/pack-box.service';
import { JOB_SWEEP_PACK_BOXES, PACK_BOX_EXPIRY_QUEUE_NAME } from './pack-box-expiry.queue';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';

/**
 * In-process worker for the pack-box expiry sweep (same Phase-1A shape
 * as the pick-expiration / reservation / accrual workers).
 *
 * Idempotent by construction: `expireOverdue` claims each box with a
 * guarded `updateMany` on `(id, status = OPEN)`, so a re-delivered job,
 * a duplicate timer, or a box closed a moment ago can never be
 * double-expired.
 */
@Injectable()
export class PackBoxExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PackBoxExpiryWorker.name);
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly boxes: PackBoxService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  onModuleInit(): void {
    // Only the queue-owning instance starts workers; every other
    // API instance serves HTTP only. See WorkerRoleService.
    if (!this.workerRole.shouldStart(PackBoxExpiryWorker.name)) return;
    this.worker = new Worker(
      PACK_BOX_EXPIRY_QUEUE_NAME,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_SWEEP_PACK_BOXES) {
          const result = await this.boxes.expireOverdue();
          // Only worth a line when it actually reclaimed something —
          // a sweep that finds nothing every five minutes is noise.
          if (result.expired > 0) {
            this.logger.log(result, 'Pack-box expiry sweep reclaimed abandoned boxes');
          }
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown pack-box expiry job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      // Only once BullMQ has stopped retrying: an exhausted job is
      // work that definitively did not happen.
      void this.issues.reportJobFailure(PackBoxExpiryWorker.name, job, err);
      this.logger.warn(
        { jobId: job?.id, name: job?.name, err: err?.message },
        'Pack-box expiry job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      // Say it where somebody will see it: a worker erroring
      // breaks no screen, the work simply stops happening.
      void this.issues.reportWorkerError(PackBoxExpiryWorker.name, err);
      this.logger.error({ err: err.message }, 'Pack-box expiry worker error');
    });
    this.logger.log(`Pack-box expiry worker ready (queue=${PACK_BOX_EXPIRY_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
