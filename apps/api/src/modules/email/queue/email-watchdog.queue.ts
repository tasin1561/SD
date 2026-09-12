import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { EmailDeliveryWatchdogService } from '../services/email-delivery-watchdog.service';

export const EMAIL_WATCHDOG_QUEUE = 'email-watchdog';
export const JOB_EMAIL_WATCHDOG = 'sweep-unsent-email';
/**
 * Every fifteen minutes. A row is only judged once it has sat thirty
 * minutes with no job behind it, so the tick only decides how far past
 * that a stuck email goes before somebody hears about it.
 */
export const EMAIL_WATCHDOG_CRON = '*/15 * * * *';

/**
 * Its own queue rather than a job on `email`: that queue is rate-limited
 * to the provider's two sends a second, and a sweep has no business
 * holding one of those slots.
 */
@Injectable()
export class EmailWatchdogQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailWatchdogQueue.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly watchdog: EmailDeliveryWatchdogService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(EMAIL_WATCHDOG_QUEUE, { connection: this.redis.createConnection() });
    // Stable jobId ⇒ re-registering on every boot is idempotent.
    await this.queue.add(
      JOB_EMAIL_WATCHDOG,
      {},
      {
        repeat: { pattern: EMAIL_WATCHDOG_CRON },
        jobId: 'email-delivery-watchdog',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );

    // Only the queue-owning instance starts workers (SCALE-1).
    if (!this.workerRole.shouldStart(EmailWatchdogQueue.name)) return;
    this.worker = new Worker(
      EMAIL_WATCHDOG_QUEUE,
      async (job: Job): Promise<void> => {
        if (job.name !== JOB_EMAIL_WATCHDOG) {
          this.logger.warn({ name: job.name }, 'Unknown email-watchdog job; ignoring');
          return;
        }
        const result = await this.watchdog.sweep();
        if (result.examined > 0) this.logger.log(result, 'Email delivery watchdog swept');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      void this.issues.reportJobFailure(EmailWatchdogQueue.name, job, err);
      this.logger.warn({ jobId: job?.id, err: err?.message }, 'Email watchdog job failed');
    });
    this.worker.on('error', (err) => {
      void this.issues.reportWorkerError(EmailWatchdogQueue.name, err);
      this.logger.error({ err: err.message }, 'Email watchdog worker error');
    });
    this.logger.log(`Email delivery watchdog ready; cron=${EMAIL_WATCHDOG_CRON}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
  }
}
