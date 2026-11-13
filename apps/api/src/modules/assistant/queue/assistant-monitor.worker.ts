import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { AssistantMonitorDigestService } from '../services/assistant-monitor-digest.service';
import { AssistantMonitorService } from '../services/assistant-monitor.service';

export const ASSISTANT_MONITOR_QUEUE = 'assistant-monitor';
export const JOB_MONITOR_NIGHTLY = 'assistant-monitor-nightly';
export const JOB_MONITOR_RUN_NOW = 'assistant-monitor-run-now';
export const JOB_MONITOR_POLL = 'assistant-monitor-poll';
export const JOB_MONITOR_WEEKLY = 'assistant-monitor-weekly';
/** 20:30 UTC = 02:30 in Dhaka: the quiet hours. The batch finishes while the team sleeps. */
export const MONITOR_NIGHTLY_CRON = '30 20 * * *';
/** Every 10 minutes: carry an open batch forward (and pick one up again after a restart). */
export const MONITOR_POLL_CRON = '*/10 * * * *';
/** Mondays 02:30 UTC = 08:30 in Dhaka. */
export const MONITOR_WEEKLY_CRON = '30 2 * * 1';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: { age: 24 * 60 * 60, count: 50 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 50 },
};

/**
 * Three repeatable jobs and one on-demand job for the overnight monitor.
 * The poll job is what makes a restart mid-batch harmless: the batch id is
 * on the run row, so the next poll after the process comes back finishes it.
 */
@Injectable()
export class AssistantMonitorWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssistantMonitorWorker.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
    private readonly monitor: AssistantMonitorService,
    private readonly digest: AssistantMonitorDigestService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(ASSISTANT_MONITOR_QUEUE, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    // Registered by every instance (stable job ids make that idempotent); consumed by one (SCALE-1).
    for (const [name, pattern] of [
      [JOB_MONITOR_NIGHTLY, MONITOR_NIGHTLY_CRON],
      [JOB_MONITOR_POLL, MONITOR_POLL_CRON],
      [JOB_MONITOR_WEEKLY, MONITOR_WEEKLY_CRON],
    ] as const) {
      await this.queue.add(
        name,
        {},
        {
          repeat: { pattern },
          jobId: `${name}-cron`,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      );
    }
    if (!this.workerRole.shouldStart(AssistantMonitorWorker.name)) return;
    this.worker = new Worker(
      ASSISTANT_MONITOR_QUEUE,
      async (job: Job): Promise<void> => {
        switch (job.name) {
          case JOB_MONITOR_NIGHTLY:
            await this.monitor.start('SCHEDULED');
            return;
          case JOB_MONITOR_RUN_NOW:
            await this.monitor.start('MANUAL');
            return;
          case JOB_MONITOR_POLL:
            await this.monitor.resume();
            return;
          case JOB_MONITOR_WEEKLY:
            await this.digest.sendWeekly();
            return;
          default:
            return;
        }
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      void this.issues.reportJobFailure(AssistantMonitorWorker.name, job, err);
      this.logger.warn({ jobId: job?.id, err: err?.message }, 'Assistant monitor job failed');
    });
    this.worker.on('error', (err) => {
      void this.issues.reportWorkerError(AssistantMonitorWorker.name, err);
      this.logger.error({ err: err.message }, 'Assistant monitor worker error');
    });
  }

  /** "Run now": queued, never run inside the request (MUST #9). */
  async enqueueRunNow(): Promise<void> {
    await this.queue.add(JOB_MONITOR_RUN_NOW, {}, { attempts: 1 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
