import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { DailyDigestService } from '../services/daily-digest.service';

export const DAILY_DIGEST_QUEUE = 'daily-digest';
export const JOB_DAILY_DIGEST = 'daily-digest-pass';

/**
 * HOURLY, on purpose — this is not a daily job that runs hourly by
 * mistake.
 *
 * The digest goes out at 08:00 in the READER's timezone, and the
 * corridor spans two (sellers in Bangladesh, reseller stores in India)
 * with a per-seller override on top. A once-a-day cron would have to
 * pick one zone and be wrong for everybody else. An hourly pass that
 * acts only on the zones currently at 08:00 is right for all of them,
 * and needs no "already sent today" bookkeeping: a zone passes 08:00
 * exactly once in twenty-four hours.
 *
 * The minute is :05 rather than :00 so it is not competing with every
 * other top-of-the-hour job for the same connections.
 */
export const DAILY_DIGEST_CRON = '5 * * * *';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  // ONE attempt. The send is deduped by the notification ledger, so a
  // retry cannot double-mail anybody — but a retry an hour later would
  // land in the next hour's window and mail the WRONG zone, which the
  // ledger has no way to notice.
  attempts: 1,
  removeOnComplete: { age: 24 * 60 * 60, count: 50 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 200 },
};

@Injectable()
export class DailyDigestWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DailyDigestWorker.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
    private readonly digest: DailyDigestService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(DAILY_DIGEST_QUEUE, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    // Registered by every instance (a stable job id makes that idempotent);
    // consumed by one (SCALE-1).
    await this.queue.add(
      JOB_DAILY_DIGEST,
      {},
      {
        repeat: { pattern: DAILY_DIGEST_CRON },
        jobId: `${JOB_DAILY_DIGEST}-cron`,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );

    if (!this.workerRole.shouldStart(DailyDigestWorker.name)) return;
    this.worker = new Worker(
      DAILY_DIGEST_QUEUE,
      async (job: Job): Promise<void> => {
        if (job.name !== JOB_DAILY_DIGEST) {
          this.logger.warn({ name: job.name }, 'Unknown daily-digest job; ignoring');
          return;
        }
        const result = await this.digest.runHour();
        this.logger.log(result, 'Daily digest pass finished');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    // A dead digest is a silent failure: nothing 500s, no screen breaks,
    // and the first sign is somebody noticing weeks later that the
    // morning email stopped. So it goes on /system-issues, where people
    // actually look, as well as into the log.
    this.worker.on('failed', (job, err) => {
      void this.issues.reportJobFailure(DailyDigestWorker.name, job, err);
      this.logger.warn({ jobId: job?.id, err: err?.message }, 'Daily digest job failed');
    });
    this.worker.on('error', (err) => {
      void this.issues.reportWorkerError(DailyDigestWorker.name, err);
      this.logger.error({ err: err.message }, 'Daily digest worker error');
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
