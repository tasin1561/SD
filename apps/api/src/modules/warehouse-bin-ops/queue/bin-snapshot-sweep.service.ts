import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { BinCollapseService } from '../services/bin-collapse.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';

export const BIN_SNAPSHOT_SWEEP_QUEUE = 'bin-snapshot-retention-sweep';
export const JOB_PURGE_SNAPSHOTS = 'purge-expired-snapshots';
/** Daily at 03:15 — retention is measured in months, not minutes. */
export const BIN_SNAPSHOT_SWEEP_CRON = '15 3 * * *';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 50 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 200 },
};

/**
 * Retires bin layout backups once they pass `ops.bin_snapshot_retention_months`.
 *
 * A snapshot holds one row per (seller, variant, bin, batch) in a
 * warehouse, so keeping every one forever grows without bound in a table
 * nobody reads. The retention window is the period in which a restore is
 * still plausible — after a few months the stock it describes has largely
 * sold, and a restore would skip most of its own lines anyway.
 */
@Injectable()
export class BinSnapshotSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BinSnapshotSweepService.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly collapse: BinCollapseService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(BIN_SNAPSHOT_SWEEP_QUEUE, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    // Stable jobId ⇒ re-registering on every boot is idempotent.
    await this.queue.add(
      JOB_PURGE_SNAPSHOTS,
      {},
      {
        repeat: { pattern: BIN_SNAPSHOT_SWEEP_CRON },
        jobId: 'bin-snapshot-retention-sweep',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );

    // Only the queue-owning instance starts workers; every other
    // API instance serves HTTP only. See WorkerRoleService (SCALE-1).
    if (!this.workerRole.shouldStart(BinSnapshotSweepService.name)) return;
    this.worker = new Worker(
      BIN_SNAPSHOT_SWEEP_QUEUE,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_PURGE_SNAPSHOTS) {
          await this.collapse.purgeExpiredSnapshots();
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown snapshot-sweep job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('error', (err) => {
      // Say it where somebody will see it: a worker erroring
      // breaks no screen, the work simply stops happening.
      void this.issues.reportWorkerError(BinSnapshotSweepService.name, err);
      this.logger.error({ err: err.message }, 'Bin snapshot sweep worker error');
    });
    this.logger.log(`Bin snapshot sweep ready; cron=${BIN_SNAPSHOT_SWEEP_CRON}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
  }
}
