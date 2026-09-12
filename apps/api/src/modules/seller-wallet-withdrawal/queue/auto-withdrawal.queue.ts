import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { AutoWithdrawalSweepService } from '../services/auto-withdrawal-sweep.service';
import { UnpayableWithdrawalService } from '../services/unpayable-withdrawal.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';

export const AUTO_WITHDRAWAL_QUEUE = 'wallet-auto-withdrawal';
export const JOB_SWEEP = 'sweep-auto-withdrawals';
/**
 * Hourly, on the hour. The sweep itself decides whose hour it is —
 * sellers pick a time in their OWN timezone, so a single daily cron
 * could only ever be right for one zone.
 */
export const AUTO_WITHDRAWAL_CRON = '5 * * * *';
/**
 * Rejecting requests the wallet can no longer pay. Every 15 minutes: a
 * stale request blocks the seller from asking for anything else, so it
 * should not wait an hour. The hourly sweep also runs it FIRST, so the
 * fresh request for what is actually available is raised in the same run.
 */
export const JOB_REJECT_UNPAYABLE = 'reject-unpayable-withdrawals';
export const REJECT_UNPAYABLE_CRON = '*/15 * * * *';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 50 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 200 },
};

@Injectable()
export class AutoWithdrawalQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoWithdrawalQueue.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly sweep: AutoWithdrawalSweepService,
    private readonly unpayable: UnpayableWithdrawalService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(AUTO_WITHDRAWAL_QUEUE, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    // Stable jobId ⇒ re-registering on every boot is idempotent.
    await this.queue.add(
      JOB_SWEEP,
      {},
      {
        repeat: { pattern: AUTO_WITHDRAWAL_CRON },
        jobId: 'wallet-auto-withdrawal-sweep',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );
    await this.queue.add(
      JOB_REJECT_UNPAYABLE,
      {},
      {
        repeat: { pattern: REJECT_UNPAYABLE_CRON },
        jobId: 'wallet-unpayable-withdrawal-sweep',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );

    // Only the queue-owning instance starts workers; every other
    // API instance serves HTTP only. See WorkerRoleService (SCALE-1).
    if (!this.workerRole.shouldStart(AutoWithdrawalQueue.name)) return;
    this.worker = new Worker(
      AUTO_WITHDRAWAL_QUEUE,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_SWEEP) {
          // Stale requests out first, so the fresh one for what is
          // actually available can be raised in this same run. Its own
          // failure must not cost anybody their automatic withdrawal.
          await this.unpayable.sweep().catch((err: unknown) => {
            this.logger.warn(
              { err: err instanceof Error ? err.message : String(err) },
              'Unpayable-withdrawal pass failed before the auto-withdrawal sweep',
            );
          });
          await this.sweep.sweep();
          return;
        }
        if (job.name === JOB_REJECT_UNPAYABLE) {
          await this.unpayable.sweep();
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown auto-withdrawal job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      // Only once BullMQ has stopped retrying: an exhausted job is
      // work that definitively did not happen.
      void this.issues.reportJobFailure(AutoWithdrawalQueue.name, job, err);
      this.logger.warn(
        { jobId: job?.id, err: err?.message },
        'Auto-withdrawal job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      // Say it where somebody will see it: a worker erroring
      // breaks no screen, the work simply stops happening.
      void this.issues.reportWorkerError(AutoWithdrawalQueue.name, err);
      this.logger.error({ err: err.message }, 'Auto-withdrawal worker error');
    });
    this.logger.log(`Auto-withdrawal sweep ready; cron=${AUTO_WITHDRAWAL_CRON}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
  }
}
