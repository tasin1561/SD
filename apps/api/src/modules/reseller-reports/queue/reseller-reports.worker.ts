import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { ResellerAutoPauseService } from '../services/reseller-auto-pause.service';
import { ResellerSweepsService } from '../services/reseller-sweeps.service';
import { StorePnlPeriodService } from '../services/store-pnl-period.service';

export const RESELLER_REPORTS_QUEUE = 'reseller-reports';
export const JOB_STORE_PNL_CLOSE = 'store-pnl-close';
export const JOB_STORE_PNL_DETECT = 'store-pnl-detect';
export const JOB_AUTO_PAUSE = 'reseller-auto-pause';
export const JOB_FRAUD_SWEEP = 'reseller-fraud-sweep';
export const JOB_STOCK_FORECAST = 'reseller-stock-forecast';
const TZ = 'Asia/Kolkata';

/** Hourly at :12 (IST) — closes every ended store month; a failure retries next hour. */
export const STORE_PNL_CLOSE_CRON = '12 * * * *';
/** Daily 06:40 IST. */
export const STORE_PNL_DETECT_CRON = '40 6 * * *';
/** Hourly at :27. */
export const AUTO_PAUSE_CRON = '27 * * * *';
/** Daily 07:05 IST. */
export const FRAUD_SWEEP_CRON = '5 7 * * *';
/** Daily 08:15 IST. */
export const STOCK_FORECAST_CRON = '15 8 * * *';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 50 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 200 },
};

/**
 * RS-8 / RS-9 — the reseller reports' schedule, on its own queue: store
 * P&L month close and carry-forward detection, the auto-pause rule, the
 * fraud sweep and the stock forecast. Repeat jobs are registered by every
 * instance (stable job ids); only the queue-owning process consumes them
 * (SCALE-1). Every job awaits everything it writes, so no work outlives it.
 */
@Injectable()
export class ResellerReportsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResellerReportsWorker.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
    private readonly periods: StorePnlPeriodService,
    private readonly autoPause: ResellerAutoPauseService,
    private readonly sweeps: ResellerSweepsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(RESELLER_REPORTS_QUEUE, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    const repeat = async (name: string, pattern: string): Promise<void> => {
      await this.queue.add(
        name,
        {},
        {
          repeat: { pattern, tz: TZ },
          jobId: `${name}-cron`,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      );
    };
    await repeat(JOB_STORE_PNL_CLOSE, STORE_PNL_CLOSE_CRON);
    await repeat(JOB_STORE_PNL_DETECT, STORE_PNL_DETECT_CRON);
    await repeat(JOB_AUTO_PAUSE, AUTO_PAUSE_CRON);
    await repeat(JOB_FRAUD_SWEEP, FRAUD_SWEEP_CRON);
    await repeat(JOB_STOCK_FORECAST, STOCK_FORECAST_CRON);

    // Only the queue-owning instance starts workers (SCALE-1).
    if (!this.workerRole.shouldStart(ResellerReportsWorker.name)) return;
    this.worker = new Worker(
      RESELLER_REPORTS_QUEUE,
      async (job: Job): Promise<void> => {
        switch (job.name) {
          case JOB_STORE_PNL_CLOSE:
            this.logResult(job.name, await this.periods.autoCloseAll());
            return;
          case JOB_STORE_PNL_DETECT:
            this.logResult(job.name, await this.periods.detectAll());
            return;
          case JOB_AUTO_PAUSE:
            this.logResult(job.name, await this.autoPause.sweep());
            return;
          case JOB_FRAUD_SWEEP:
            this.logResult(job.name, await this.sweeps.fraud());
            return;
          case JOB_STOCK_FORECAST:
            this.logResult(job.name, await this.sweeps.stock());
            return;
          default:
            this.logger.warn({ name: job.name }, 'Unknown reseller reports job; ignoring');
        }
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      void this.issues.reportJobFailure(ResellerReportsWorker.name, job, err);
      this.logger.warn({ jobId: job?.id, err: err?.message }, 'Reseller reports job failed');
    });
    this.worker.on('error', (err) => {
      void this.issues.reportWorkerError(ResellerReportsWorker.name, err);
      this.logger.error({ err: err.message }, 'Reseller reports worker error');
    });
    this.logger.log('Reseller reports schedule ready');
  }

  private logResult(name: string, result: object): void {
    this.logger.log({ job: name, ...result }, 'Reseller reports job finished');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
  }
}
