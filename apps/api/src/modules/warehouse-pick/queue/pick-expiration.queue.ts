import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export const PICK_EXPIRATION_QUEUE_NAME = 'warehouse-pick-expiration';
export const JOB_EXPIRE_PICK = 'expire-pick';

export interface ExpirePickJob {
  shipmentId: string;
  /** ISO of the pickStartedAt this job was scheduled for. A delivery
   *  whose shipment is no longer claimed-with-this-pickStartedAt is a
   *  no-op (WMS-5, the M7-assignedAt-analogue CAS token). */
  pickStartedAtIso: string;
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 500 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 2_000 },
};

/**
 * Module 8 — delayed-job queue for WMS-5 pick-task expiration. Lives in
 * `warehouse-pick` (alongside the service it drives), mirroring M7's
 * AssignmentExpirationQueue exactly.
 */
@Injectable()
export class PickExpirationQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PickExpirationQueue.name);
  private queue!: Queue<ExpirePickJob>;

  constructor(private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<ExpirePickJob>(PICK_EXPIRATION_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    this.logger.log(`Pick-expiration queue ready (name=${PICK_EXPIRATION_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }

  /** Schedule a delayed expiry sweep. `jobId` is deterministic per
   *  (shipment, pickStartedAt) so a re-pull producing the *same*
   *  pickStartedAt can't pile up duplicate timers (extra idempotency
   *  atop the time-based CAS in the service). BullMQ forbids ':' in a
   *  custom jobId (its Redis key separator), so the ISO timestamp is
   *  encoded as epoch-ms and joined with '_' (same rule as M7 CC-7). */
  async enqueueExpiration(data: ExpirePickJob, delayMs: number): Promise<string> {
    const stamp = Date.parse(data.pickStartedAtIso);
    const jobId = `${data.shipmentId}_${Number.isNaN(stamp) ? data.pickStartedAtIso.replace(/[:.]/g, '-') : stamp}`;
    const job = await this.queue.add(JOB_EXPIRE_PICK, data, {
      delay: Math.max(0, delayMs),
      jobId,
    });
    return String(job.id);
  }
}
