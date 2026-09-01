import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { TrackingPollService } from '../services/tracking-poll.service';
import {
  JOB_POLL_TRACKING,
  JOB_TRACKING_WATCHDOG,
  TRACKING_POLL_QUEUE_NAME,
} from './tracking-poll.queue';
import { TrackingRecoveryService } from '../services/tracking-recovery.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';

/**
 * Module 10 (poll) — in-process BullMQ worker for the Delhivery
 * tracking poll cron. Delegates each fired job to
 * `TrackingPollService.pollAll()` (idempotent + stub-inert). Concurrency
 * 1 — one poll cycle at a time; a cycle bounds its own work
 * (MAX_SHIPMENTS_PER_CYCLE) and the cron re-fires to drain any backlog.
 */
@Injectable()
export class TrackingPollWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackingPollWorker.name);
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly poll: TrackingPollService,
    private readonly recovery: TrackingRecoveryService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  onModuleInit(): void {
    // Only the queue-owning instance starts workers; every other
    // API instance serves HTTP only. See WorkerRoleService.
    if (!this.workerRole.shouldStart(TrackingPollWorker.name)) return;
    this.worker = new Worker(
      TRACKING_POLL_QUEUE_NAME,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_POLL_TRACKING) {
          await this.poll.pollAll();
          return;
        }
        if (job.name === JOB_TRACKING_WATCHDOG) {
          const outcome = await this.recovery.check();
          if (!outcome.healthy) {
            this.logger.error({ ...outcome }, 'Tracking watchdog found a stall');
          }
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown tracking-poll job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { jobId: job?.id, err: err?.message },
        'tracking-poll job failed (next cron run retries)',
      );
    });
    this.worker.on('error', (err) => {
      // Say it where somebody will see it: a worker erroring
      // breaks no screen, the work simply stops happening.
      void this.issues.reportWorkerError(TrackingPollWorker.name, err);
      this.logger.error({ err: err.message }, 'tracking-poll worker error');
    });
    this.logger.log(`tracking-poll worker ready (queue=${TRACKING_POLL_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
