import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { AssignmentExpirationService } from '../services/assignment-expiration.service';
import {
  ASSIGNMENT_EXPIRATION_QUEUE_NAME,
  JOB_EXPIRE_ASSIGNMENT,
  type ExpireAssignmentJob,
} from './assignment-expiration.queue';

/**
 * In-process assignment-expiration worker (Phase 1A pattern). Delegates
 * to AssignmentExpirationService.expire(), which is time-based
 * idempotent (CC-7): a stale / re-delivered job for an entry that is no
 * longer ASSIGNED-with-that-assignedAt is a safe no-op.
 */
@Injectable()
export class AssignmentExpirationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssignmentExpirationWorker.name);
  private worker!: Worker<ExpireAssignmentJob>;

  constructor(
    private readonly redis: RedisService,
    private readonly service: AssignmentExpirationService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<ExpireAssignmentJob>(
      ASSIGNMENT_EXPIRATION_QUEUE_NAME,
      async (job: Job<ExpireAssignmentJob>): Promise<void> => {
        if (job.name === JOB_EXPIRE_ASSIGNMENT) {
          await this.service.expire(job.data.assignmentId, job.data.assignedAtIso);
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown assignment-expiration job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { jobId: job?.id, err: err?.message },
        'Assignment-expiration job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      this.logger.error({ err: err.message }, 'Assignment-expiration worker error');
    });
    this.logger.log(
      `Assignment-expiration worker ready (queue=${ASSIGNMENT_EXPIRATION_QUEUE_NAME})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
