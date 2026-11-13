import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { AssistantRetentionService } from '../services/assistant-retention.service';

export const ASSISTANT_RETENTION_QUEUE = 'assistant-retention';
export const JOB_ASSISTANT_RETENTION = 'assistant-retention-pass';
/** Once a day, 21:30 UTC (03:30 in Dhaka), when nobody is asking questions. */
export const ASSISTANT_RETENTION_CRON = '30 21 * * *';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  // The pass is idempotent, but tomorrow's run is the retry.
  attempts: 1,
  removeOnComplete: { age: 24 * 60 * 60, count: 20 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 50 },
};

/** Daily BullMQ job that anonymises conversations idle for 180 days. */
@Injectable()
export class AssistantRetentionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssistantRetentionWorker.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
    private readonly retention: AssistantRetentionService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(ASSISTANT_RETENTION_QUEUE, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    // Registered by every instance (a stable job id makes that idempotent); consumed by one (SCALE-1).
    await this.queue.add(
      JOB_ASSISTANT_RETENTION,
      {},
      {
        repeat: { pattern: ASSISTANT_RETENTION_CRON },
        jobId: `${JOB_ASSISTANT_RETENTION}-cron`,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );
    if (!this.workerRole.shouldStart(AssistantRetentionWorker.name)) return;
    this.worker = new Worker(
      ASSISTANT_RETENTION_QUEUE,
      async (job: Job): Promise<void> => {
        if (job.name !== JOB_ASSISTANT_RETENTION) return;
        await this.retention.run();
        await this.retention.purgePublic();
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      void this.issues.reportJobFailure(AssistantRetentionWorker.name, job, err);
      this.logger.warn({ jobId: job?.id, err: err?.message }, 'Assistant retention job failed');
    });
    this.worker.on('error', (err) => {
      void this.issues.reportWorkerError(AssistantRetentionWorker.name, err);
      this.logger.error({ err: err.message }, 'Assistant retention worker error');
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
