import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { ConsigneeVerifyService } from '../services/consignee-verify.service';

export const CONSIGNEE_VERIFY_QUEUE = 'courier-consignee-verify';
export const JOB_CONSIGNEE_VERIFY = 'verify-consignee-changes';

/**
 * Every twenty minutes, not every minute and not once a night.
 *
 * A seller who has just corrected an address wants to know it landed,
 * so nightly is too slow to be an answer. But each run drives a browser
 * against a courier's portal, which is rate-limited and will present a
 * challenge if leaned on — so a tight loop buys minutes of freshness at
 * the cost of the whole channel.
 *
 * Twenty minutes is the compromise, and the seller is told "sent,
 * awaiting confirmation" in the meantime rather than a guess.
 */
export const CONSIGNEE_VERIFY_CRON = '*/20 * * * *';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  // One attempt. A retry that logs into a courier's portal again is how
  // an account gets locked, and the sweep is idempotent by construction
  // — anything left unverified is picked up twenty minutes later.
  attempts: 1,
  removeOnComplete: { age: 3 * 24 * 60 * 60, count: 50 },
  removeOnFail: { age: 14 * 24 * 60 * 60, count: 50 },
};

@Injectable()
export class ConsigneeVerifyWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConsigneeVerifyWorker.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly verify: ConsigneeVerifyService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  async onModuleInit(): Promise<void> {
    // SCALE-1, and the portal half of it: this drives Chromium, so it
    // runs in the portal process and nowhere else.
    if (!this.workerRole.shouldStartPortal(ConsigneeVerifyWorker.name)) return;

    this.queue = new Queue(CONSIGNEE_VERIFY_QUEUE, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    await this.queue.add(
      JOB_CONSIGNEE_VERIFY,
      {},
      {
        repeat: { pattern: CONSIGNEE_VERIFY_CRON },
        jobId: 'courier-consignee-verify',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 14 * 24 * 60 * 60 },
      },
    );

    this.worker = new Worker(
      CONSIGNEE_VERIFY_QUEUE,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_CONSIGNEE_VERIFY) {
          await this.verify.sweep();
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown consignee-verify job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      // Only once BullMQ has stopped retrying: an exhausted job is work
      // that definitively did not happen.
      void this.issues.reportJobFailure(ConsigneeVerifyWorker.name, job, err);
      this.logger.warn({ jobId: job?.id, err: err?.message }, 'Consignee verify job failed');
    });
    this.worker.on('error', (err) => {
      void this.issues.reportWorkerError(ConsigneeVerifyWorker.name, err);
      this.logger.error({ err: err.message }, 'Consignee verify worker error');
    });

    this.logger.log(`Consignee verification ready; cron=${CONSIGNEE_VERIFY_CRON}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
  }
}
