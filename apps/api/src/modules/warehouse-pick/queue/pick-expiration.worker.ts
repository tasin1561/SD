import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { PickExpirationService } from '../services/pick-expiration.service';
import {
  PICK_EXPIRATION_QUEUE_NAME,
  JOB_EXPIRE_PICK,
  type ExpirePickJob,
} from './pick-expiration.queue';

/**
 * In-process pick-expiration worker (Phase 1A pattern, mirrors M7's
 * AssignmentExpirationWorker). Delegates to PickExpirationService.
 * expire(), which is time-based idempotent (WMS-5): a stale /
 * re-delivered job for a parcel no longer claimed-with-that-pickStartedAt
 * is a safe no-op.
 */
@Injectable()
export class PickExpirationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PickExpirationWorker.name);
  private worker!: Worker<ExpirePickJob>;

  constructor(
    private readonly redis: RedisService,
    private readonly service: PickExpirationService,
    private readonly workerRole: WorkerRoleService,
  ) {}

  onModuleInit(): void {
    // Only the queue-owning instance starts workers; every other
    // API instance serves HTTP only. See WorkerRoleService.
    if (!this.workerRole.shouldStart(PickExpirationWorker.name)) return;
    this.worker = new Worker<ExpirePickJob>(
      PICK_EXPIRATION_QUEUE_NAME,
      async (job: Job<ExpirePickJob>): Promise<void> => {
        if (job.name === JOB_EXPIRE_PICK) {
          await this.service.expire(job.data.shipmentId, job.data.pickStartedAtIso);
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown pick-expiration job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { jobId: job?.id, err: err?.message },
        'Pick-expiration job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      this.logger.error({ err: err.message }, 'Pick-expiration worker error');
    });
    this.logger.log(`Pick-expiration worker ready (queue=${PICK_EXPIRATION_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
