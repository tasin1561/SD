import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export const ASSIGNMENT_EXPIRATION_QUEUE_NAME = 'call-assignment-expiration';
export const JOB_EXPIRE_ASSIGNMENT = 'expire-assignment';

export interface ExpireAssignmentJob {
  assignmentId: string;
  /** ISO of the assignedAt this job was scheduled for. A delivery whose
   *  entry is no longer ASSIGNED-with-this-assignedAt is a no-op (CC-7). */
  assignedAtIso: string;
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 500 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 2_000 },
};

/**
 * Module 7 — delayed-job queue for CC-7 assignment expiration. Lives in
 * `call-center` (alongside the service it drives); the queue PRIMITIVE
 * (`call-queue`) stays Order-/timer-free by design.
 */
@Injectable()
export class AssignmentExpirationQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssignmentExpirationQueue.name);
  private queue!: Queue<ExpireAssignmentJob>;

  constructor(private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<ExpireAssignmentJob>(
      ASSIGNMENT_EXPIRATION_QUEUE_NAME,
      {
        connection: this.redis.createConnection(),
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      },
    );
    this.logger.log(
      `Assignment-expiration queue ready (name=${ASSIGNMENT_EXPIRATION_QUEUE_NAME})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }

  /** Schedule a delayed expiry sweep. `jobId` is deterministic per
   *  (assignment, assignedAt) so a re-pull producing the *same*
   *  assignedAt can't pile up duplicate timers (extra idempotency atop
   *  the time-based check in the service). BullMQ forbids ':' in a
   *  custom jobId (its Redis key separator), so the ISO timestamp is
   *  encoded as epoch-ms and joined with '_'. */
  async enqueueExpiration(
    data: ExpireAssignmentJob,
    delayMs: number,
  ): Promise<string> {
    const stamp = Date.parse(data.assignedAtIso);
    const jobId = `${data.assignmentId}_${Number.isNaN(stamp) ? data.assignedAtIso.replace(/[:.]/g, '-') : stamp}`;
    const job = await this.queue.add(JOB_EXPIRE_ASSIGNMENT, data, {
      delay: Math.max(0, delayMs),
      jobId,
    });
    return String(job.id);
  }
}
