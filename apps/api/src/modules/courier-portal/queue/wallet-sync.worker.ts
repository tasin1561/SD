import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { WalletSyncService } from '../services/wallet-sync.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { DelhiveryBillingProbeService } from '../services/delhivery-billing-probe.service';

/**
 * Restated in `courier-cost-sync/services/wallet-sync-trigger.service.ts`;
 * `wallet-sync-queue-names.spec.ts` fails if the copies drift.
 */
export const WALLET_SYNC_QUEUE = 'courier-wallet-sync';
export const JOB_WALLET_SYNC = 'sync-delhivery-wallet';
/**
 * The one-off read-only look at Delhivery's billing pages. On THIS queue on
 * purpose: its worker runs one job at a time, so the probe and the nightly
 * sync can never be signed in to the same Delhivery login at once.
 */
export const JOB_DELHIVERY_BILLING_PROBE = 'probe-delhivery-billing';

/**
 * Once a night, well after the day's charges have settled.
 *
 * 02:40 IST is 21:10 UTC, which is where this lands. Not on the hour,
 * because everything else in this system is: a browser-driving job that
 * takes a minute should not be competing with five sweeps for the same
 * moment.
 */
export const WALLET_SYNC_CRON = '10 21 * * *';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  // One attempt per night, deliberately. A retry loop that logs into a
  // courier's portal repeatedly is how an account gets locked, and the
  // window is rolling — a missed night is picked up by the next one.
  attempts: 1,
  removeOnComplete: { age: 14 * 24 * 60 * 60, count: 30 },
  removeOnFail: { age: 30 * 24 * 60 * 60, count: 60 },
};

@Injectable()
export class WalletSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WalletSyncWorker.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly sync: WalletSyncService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
    private readonly billingProbe: DelhiveryBillingProbeService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Only the queue-owning instance starts workers; every other API
    // instance serves HTTP only. See WorkerRoleService (SCALE-1).
    if (!this.workerRole.shouldStartPortal(WalletSyncWorker.name)) return;

    this.queue = new Queue(WALLET_SYNC_QUEUE, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    await this.queue.add(
      JOB_WALLET_SYNC,
      {},
      {
        repeat: { pattern: WALLET_SYNC_CRON },
        jobId: 'courier-wallet-sync',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 30 * 24 * 60 * 60 },
      },
    );

    this.worker = new Worker(
      WALLET_SYNC_QUEUE,
      async (
        job: Job<{ runId?: string; requestedByStaffId?: string; manual?: boolean }>,
      ): Promise<void> => {
        if (job.name === JOB_WALLET_SYNC) {
          await this.sync.sync();
          return;
        }
        if (job.name === JOB_DELHIVERY_BILLING_PROBE) {
          // Regardless of portalMode, like the sync itself: CUR-18's OFF
          // stops the escalation automation, not an operator's read.
          await this.billingProbe.probe({
            runId: job.data.runId ?? null,
            requestedByStaffId: job.data.requestedByStaffId ?? null,
          });
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown wallet-sync job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      // Only once BullMQ has stopped retrying: an exhausted job is
      // work that definitively did not happen.
      void this.issues.reportJobFailure(WalletSyncWorker.name, job, err);
      this.logger.warn(
        { jobId: job?.id, err: err?.message },
        'Wallet sync job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      // Say it where somebody will see it: a worker erroring
      // breaks no screen, the work simply stops happening.
      void this.issues.reportWorkerError(WalletSyncWorker.name, err);
      this.logger.error({ err: err.message }, 'Wallet sync worker error');
    });
    this.logger.log(`Delhivery wallet sync ready; cron=${WALLET_SYNC_CRON}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
  }
}
