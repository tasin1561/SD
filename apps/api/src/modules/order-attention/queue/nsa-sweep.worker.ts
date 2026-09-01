import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { OrderAttentionService } from '../services/order-attention.service';

export const NSA_SWEEP_QUEUE = 'order-nsa-sweep';
export const JOB_NSA_SWEEP = 'sweep-nsa';

/**
 * Hourly, not once at 18:00.
 *
 * The sweep itself decides whether the cutoff has passed in the DELIVERY
 * timezone, so an hourly tick is right regardless of where the server
 * runs — and it means a missed 18:00 (a deploy, a restart, a queue
 * hiccup) costs an hour rather than a night. A parcel stuck since the
 * afternoon should not wait until tomorrow to be noticed because the
 * process happened to be restarting at six.
 */
export const NSA_SWEEP_CRON = '10 * * * *';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 50 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 200 },
};

@Injectable()
export class NsaSweepWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NsaSweepWorker.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly attention: OrderAttentionService,
    private readonly workerRole: WorkerRoleService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Only the queue-owning instance starts workers; every other API
    // instance serves HTTP only. See WorkerRoleService (SCALE-1).
    if (!this.workerRole.shouldStart(NsaSweepWorker.name)) return;

    this.queue = new Queue(NSA_SWEEP_QUEUE, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    // Stable jobId ⇒ re-registering on every boot is idempotent.
    await this.queue.add(
      JOB_NSA_SWEEP,
      {},
      {
        repeat: { pattern: NSA_SWEEP_CRON },
        jobId: 'order-nsa-sweep',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );

    this.worker = new Worker(
      NSA_SWEEP_QUEUE,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_NSA_SWEEP) {
          await this.attention.sweep();
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown NSA job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('error', (err) => {
      this.logger.error({ err: err.message }, 'NSA sweep worker error');
    });
    this.logger.log(`NSA sweep ready; cron=${NSA_SWEEP_CRON}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
  }
}
