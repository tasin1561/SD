import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { PnlPeriodService } from '../services/pnl-period.service';
import { monthOf } from '../services/pnl-month';

export const PNL_PERIOD_QUEUE = 'pnl-period';
export const JOB_PNL_AUTO_CLOSE = 'pnl-auto-close';
export const JOB_PNL_DETECT = 'pnl-detect-carry-forwards';
/**
 * Every hour on the hour. The close itself acts only from 06:00 IST on the
 * 1st (after the 04:30 invoice check) and only while a finished month is
 * unclosed, so every other hour it is one cheap query. Hourly is the
 * retry: a month whose nightly jobs had not all succeeded closes on the
 * first hour after they have.
 */
export const PNL_AUTO_CLOSE_CRON = '0 * * * *';
/** 06:15 IST daily — after the nightly jobs and the 06:00 close. */
export const PNL_DETECT_CRON = '15 6 * * *';
export const PNL_TZ = 'Asia/Kolkata';

/**
 * The scheduled close and the daily carry-forward detection (PNL-CF-1).
 * One queue, concurrency one, so a close and a detection never run at the
 * same time; the advisory lock in the service is the guard across
 * processes.
 */
@Injectable()
export class PnlPeriodWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PnlPeriodWorker.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly periods: PnlPeriodService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Only the queue-owning instance schedules and runs this (SCALE-1): a
    // second would close the month twice (harmless) and detect twice at
    // once (serialised by the lock, but pointless).
    if (!this.workerRole.shouldStart(PnlPeriodWorker.name)) return;

    this.queue = new Queue(PNL_PERIOD_QUEUE, {
      connection: this.redis.createConnection(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 14 * 24 * 60 * 60, count: 50 },
        removeOnFail: { age: 60 * 24 * 60 * 60, count: 100 },
      },
    });
    await this.queue.add(
      JOB_PNL_AUTO_CLOSE,
      {},
      { repeat: { pattern: PNL_AUTO_CLOSE_CRON, tz: PNL_TZ }, jobId: 'pnl-auto-close-cron' },
    );
    await this.queue.add(
      JOB_PNL_DETECT,
      {},
      { repeat: { pattern: PNL_DETECT_CRON, tz: PNL_TZ }, jobId: 'pnl-detect-cron' },
    );

    this.worker = new Worker(
      PNL_PERIOD_QUEUE,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_PNL_AUTO_CLOSE) {
          const res = await this.periods.autoClose(new Date());
          if (res.closed.length > 0) this.logger.log({ closed: res.closed }, 'P&L months closed');
          return;
        }
        if (job.name === JOB_PNL_DETECT) {
          const res = await this.periods.detect(monthOf(new Date()), new Date());
          this.logger.log(
            { landedMonth: res.landedMonth, rows: res.rowsAdded },
            'P&L carry-forward detection done',
          );
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown pnl-period job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      void this.issues.reportJobFailure(PnlPeriodWorker.name, job, err);
      this.logger.warn({ jobId: job?.id, err: err?.message }, 'pnl-period job failed');
    });
    this.worker.on('error', (err) => {
      void this.issues.reportWorkerError(PnlPeriodWorker.name, err);
      this.logger.error({ err: err.message }, 'pnl-period worker error');
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker !== null) await this.worker.close();
    if (this.queue !== null) await this.queue.close();
  }
}
