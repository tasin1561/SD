import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { AddressCheckRetryService } from '../services/address-check-retry.service';
import { AddressFeedbackService } from '../services/address-feedback.service';
import { OrderAddressCheckBackfillService } from '../services/order-address-check-backfill.service';
import {
  ADDRESS_CHECK_QUEUE_NAME,
  AddressCheckQueue,
  JOB_BACKFILL_CHECKS,
  JOB_COLLECT_BATCH,
  JOB_RETRY_CHECK,
  JOB_SEND_FEEDBACK,
  RETRY_BACKOFF_MS,
  type CollectBatchJob,
  type RetryCheckJob,
} from './address-check.queue';

/**
 * How many times a batch is asked whether it is finished.
 *
 * 24 polls at 5 seconds is two minutes, which is generous for a job the
 * vendor answers in about a second per item. Bounded because an
 * unbounded poll chain on a job that never completes is a queue that
 * never empties.
 */
const MAX_BATCH_POLLS = 24;

/**
 * The address check's background half: re-asking about a check that
 * could not be made, and telling Solustation what the courier did.
 *
 * Neither has anybody waiting on it. A retry runs while the operator
 * who saw "Address check unavailable" has long since saved the order,
 * and the feedback sweep reads scans recorded hours ago. That is the
 * whole reason they are jobs: an order and a courier update must never
 * wait on a third party.
 */
@Injectable()
export class AddressCheckWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AddressCheckWorker.name);
  private worker: Worker | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
    private readonly queue: AddressCheckQueue,
    private readonly retry: AddressCheckRetryService,
    private readonly feedback: AddressFeedbackService,
    private readonly backfill: OrderAddressCheckBackfillService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.workerRole.shouldStart(AddressCheckWorker.name)) return;

    this.worker = new Worker(
      ADDRESS_CHECK_QUEUE_NAME,
      async (job: Job) => {
        if (job.name === JOB_SEND_FEEDBACK) {
          const result = await this.feedback.sweep();
          if (result.sent > 0) this.logger.log(result, 'Courier feedback sent');
          return;
        }
        if (job.name === JOB_RETRY_CHECK) {
          const { referenceId } = job.data as RetryCheckJob;
          // The repeatable carries no reference: it is the SWEEP, which
          // finds the rows whose turn has come. A job that names one is
          // a single re-ask queued when that check failed.
          if (referenceId === '') {
            const swept = await this.retry.sweep();
            if (swept > 0) this.logger.log({ swept }, 'Queued address checks for a re-ask');
            return;
          }
          await this.retry.retryOne(referenceId);
          return;
        }
        if (job.name === JOB_BACKFILL_CHECKS) {
          const result = await this.backfill.sweep();
          if (result.found > 0) this.logger.log(result, 'Backfilled order address checks');
          // A batch was opened rather than checked one at a time, so
          // somebody has to go back for the answers.
          if (result.batchJobId !== null) {
            await this.queue.enqueueCollect({ jobId: result.batchJobId, polls: 0 });
          }
          return;
        }
        if (job.name === JOB_COLLECT_BATCH) {
          await this.collectBatch(job.data as CollectBatchJob);
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown address-check job; ignoring');
      },
      {
        connection: this.redis.createConnection(),
        concurrency: 2,
        settings: {
          // Explicit per-attempt delays: six tries spread across an
          // hour rather than bunched in its first eight minutes. A
          // service that is down at minute one is usually still down at
          // minute two.
          backoffStrategy: (attemptsMade: number): number =>
            RETRY_BACKOFF_MS[Math.min(attemptsMade, RETRY_BACKOFF_MS.length - 1)] ?? 60_000,
        },
      },
    );

    this.worker.on('failed', (job, err) => {
      // Only once BullMQ has stopped retrying: an exhausted job is work
      // that definitively did not happen.
      void this.issues.reportJobFailure(AddressCheckWorker.name, job, err);
    });
    this.worker.on('error', (err) => {
      void this.issues.reportWorkerError(AddressCheckWorker.name, err);
    });

    await this.queue.registerSweeps();
    this.logger.log('Address-check worker ready (retry + courier feedback)');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  /**
   * Ask whether a batch is done; if not, ask again later.
   *
   * ── WHY IT RE-ENQUEUES INSTEAD OF LOOPING ────────────────────────────
   * A 1,000-item job takes as long as it takes, and a worker sitting in
   * a sleep loop is a worker not sending feedback or re-asking a failed
   * check. Each poll is its own short job, so the concurrency-2 worker
   * stays available throughout.
   *
   * ── AND WHY GIVING UP IS SAFE ────────────────────────────────────────
   * After `MAX_BATCH_POLLS` it stops asking and says so. Nothing is lost:
   * the orders in that batch still have no `address_checks` row, so the
   * next backfill sweep finds them and opens a new batch carrying the
   * SAME reference ids — which Solustation answers from storage, free.
   * That is the same recovery path as a dropped job or a restart, which
   * is why none of those cases needs its own handling.
   */
  private async collectBatch(data: CollectBatchJob): Promise<void> {
    const { done, stored } = await this.backfill.collectBatch(data.jobId);
    if (done) {
      if (stored > 0) this.logger.log({ jobId: data.jobId, stored }, 'Batch checks stored');
      return;
    }
    if (data.polls + 1 >= MAX_BATCH_POLLS) {
      this.logger.warn(
        { jobId: data.jobId, polls: data.polls + 1 },
        'Batch still not done; giving up — the next backfill sweep will re-open it',
      );
      return;
    }
    await this.queue.enqueueCollect({ jobId: data.jobId, polls: data.polls + 1 });
  }
}
