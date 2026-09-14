import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { ResellerSetAsideSweepService } from '../services/reseller-set-aside-sweep.service';

export const RESELLER_SET_ASIDE_QUEUE = 'reseller-set-aside';
export const JOB_SHRINK_SET_ASIDES = 'shrink-set-asides';
/** Hourly, at :20 — clear of the :05 withdrawal sweep and the top of the hour. */
export const RESELLER_SET_ASIDE_CRON = '20 * * * *';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 50 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 200 },
};

/**
 * RS-3 — the hourly reseller set-aside sweep, on its own queue.
 *
 * The repeat job is registered by every instance (a stable jobId makes
 * that idempotent); only the queue-owning process consumes it (SCALE-1,
 * `WorkerRoleService`). The sweep awaits everything it writes, so no
 * work outlives the job.
 */
@Injectable()
export class ResellerSetAsideWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResellerSetAsideWorker.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly sweep: ResellerSetAsideSweepService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(RESELLER_SET_ASIDE_QUEUE, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    await this.queue.add(
      JOB_SHRINK_SET_ASIDES,
      {},
      {
        repeat: { pattern: RESELLER_SET_ASIDE_CRON },
        jobId: 'reseller-set-aside-sweep',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );

    // Only the queue-owning instance starts workers; every other API
    // instance serves HTTP only. See WorkerRoleService (SCALE-1).
    if (!this.workerRole.shouldStart(ResellerSetAsideWorker.name)) return;
    this.worker = new Worker(
      RESELLER_SET_ASIDE_QUEUE,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_SHRINK_SET_ASIDES) {
          const result = await this.sweep.sweep();
          if (result.shrunk > 0 || result.failures > 0) {
            this.logger.log(result, 'Reseller set-aside sweep finished');
          }
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown reseller set-aside job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      // Only once BullMQ has stopped retrying: an exhausted job is work
      // that definitively did not happen.
      void this.issues.reportJobFailure(ResellerSetAsideWorker.name, job, err);
      this.logger.warn({ jobId: job?.id, err: err?.message }, 'Reseller set-aside job failed');
    });
    this.worker.on('error', (err) => {
      void this.issues.reportWorkerError(ResellerSetAsideWorker.name, err);
      this.logger.error({ err: err.message }, 'Reseller set-aside worker error');
    });
    this.logger.log(`Reseller set-aside sweep ready; cron=${RESELLER_SET_ASIDE_CRON}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
  }
}
