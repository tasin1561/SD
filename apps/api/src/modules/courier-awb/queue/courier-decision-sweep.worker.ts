import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { CourierDecisionService } from '../services/courier-decision.service';

export const COURIER_DECISION_SWEEP_QUEUE = 'courier-decision-sweep';
export const JOB_COURIER_DECISION_SWEEP = 'sweep-courier-decisions';

/**
 * Every fifteen minutes, not hourly.
 *
 * The TTL is measured in hours, so the tick only decides how much
 * OVERSHOOT a parcel suffers past a deadline it has already missed —
 * and by then it is a confirmed order whose customer has been told it
 * is on the way. Fifteen minutes costs nothing (the sweep is one
 * indexed query when the queue is empty, which is the ordinary case)
 * and keeps the overshoot small.
 */
export const COURIER_DECISION_SWEEP_CRON = '*/15 * * * *';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 50 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 200 },
};

/** CUR-17 — books what nobody chose. See `CourierDecisionService.sweepExpired`. */
@Injectable()
export class CourierDecisionSweepWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CourierDecisionSweepWorker.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly decisions: CourierDecisionService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  async onModuleInit(): Promise<void> {
    // SCALE-1 — only the queue-owning instance starts workers. Two
    // instances sweeping would both read the same waiting parcel and
    // both try to book it.
    if (!this.workerRole.shouldStart(CourierDecisionSweepWorker.name)) return;

    this.queue = new Queue(COURIER_DECISION_SWEEP_QUEUE, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    await this.queue.add(
      JOB_COURIER_DECISION_SWEEP,
      {},
      {
        repeat: { pattern: COURIER_DECISION_SWEEP_CRON },
        // Stable jobId ⇒ re-registering on every boot is idempotent.
        jobId: 'courier-decision-sweep',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );

    this.worker = new Worker(
      COURIER_DECISION_SWEEP_QUEUE,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_COURIER_DECISION_SWEEP) {
          const r = await this.decisions.sweepExpired();
          if (r.picked > 0 || r.skipped > 0) {
            this.logger.log(r, 'courier decision sweep');
          }
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown courier decision job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      void this.issues.reportJobFailure(CourierDecisionSweepWorker.name, job, err);
    });
    this.worker.on('error', (err) => {
      // A sweep that stopped running breaks no screen — parcels simply
      // wait forever, which is the failure it exists to prevent.
      void this.issues.reportWorkerError(CourierDecisionSweepWorker.name, err);
      this.logger.error({ err: err.message }, 'courier decision sweep worker error');
    });
    this.logger.log(`Courier decision sweep ready; cron=${COURIER_DECISION_SWEEP_CRON}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
  }
}
