import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { AutoWithdrawalSweepService } from '../services/auto-withdrawal-sweep.service';

export const AUTO_WITHDRAWAL_QUEUE = 'wallet-auto-withdrawal';
export const JOB_SWEEP = 'sweep-auto-withdrawals';
/**
 * Hourly, on the hour. The sweep itself decides whose hour it is —
 * sellers pick a time in their OWN timezone, so a single daily cron
 * could only ever be right for one zone.
 */
export const AUTO_WITHDRAWAL_CRON = '5 * * * *';

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
    private readonly workerRole: WorkerRoleService,
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

    // Only the queue-owning instance starts workers; every other
    // API instance serves HTTP only. See WorkerRoleService (SCALE-1).
    if (!this.workerRole.shouldStart(AutoWithdrawalQueue.name)) return;
    this.worker = new Worker(
      AUTO_WITHDRAWAL_QUEUE,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_SWEEP) {
          await this.sweep.sweep();
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown auto-withdrawal job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('error', (err) => {
      this.logger.error({ err: err.message }, 'Auto-withdrawal worker error');
    });
    this.logger.log(`Auto-withdrawal sweep ready; cron=${AUTO_WITHDRAWAL_CRON}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
  }
}
