import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { TrackingPollService } from '../services/tracking-poll.service';
import { JOB_POLL_TRACKING, TRACKING_POLL_QUEUE_NAME } from './tracking-poll.queue';

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
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      TRACKING_POLL_QUEUE_NAME,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_POLL_TRACKING) {
          await this.poll.pollAll();
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
      this.logger.error({ err: err.message }, 'tracking-poll worker error');
    });
    this.logger.log(`tracking-poll worker ready (queue=${TRACKING_POLL_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
