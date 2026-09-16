import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { BackupWatchService } from '../services/backup-watch.service';

export const BACKUP_WATCH_QUEUE = 'backup-watch';
export const JOB_BACKUP_WATCH = 'check-offsite-backup';
/** Hourly, at :20 — ten minutes after the backup's own :10 start. */
export const BACKUP_WATCH_CRON = '20 * * * *';

@Injectable()
export class BackupWatchQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupWatchQueue.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly watch: BackupWatchService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(BACKUP_WATCH_QUEUE, { connection: this.redis.createConnection() });
    // Stable jobId ⇒ re-registering on every boot is idempotent.
    await this.queue.add(
      JOB_BACKUP_WATCH,
      {},
      {
        repeat: { pattern: BACKUP_WATCH_CRON },
        jobId: 'backup-watch',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );

    // Only the queue-owning instance starts workers (SCALE-1).
    if (!this.workerRole.shouldStart(BackupWatchQueue.name)) return;
    this.worker = new Worker(
      BACKUP_WATCH_QUEUE,
      async (job: Job): Promise<void> => {
        if (job.name !== JOB_BACKUP_WATCH) {
          this.logger.warn({ name: job.name }, 'Unknown backup-watch job; ignoring');
          return;
        }
        await this.watch.check();
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      void this.issues.reportJobFailure(BackupWatchQueue.name, job, err);
      this.logger.warn({ jobId: job?.id, err: err?.message }, 'Backup watch job failed');
    });
    this.worker.on('error', (err) => {
      void this.issues.reportWorkerError(BackupWatchQueue.name, err);
      this.logger.error({ err: err.message }, 'Backup watch worker error');
    });
    this.logger.log(`Off-site backup watch ready; cron=${BACKUP_WATCH_CRON}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
  }
}
