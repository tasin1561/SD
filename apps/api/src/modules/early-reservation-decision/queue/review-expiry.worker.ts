import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { ReviewExpirySweepService } from '../services/review-expiry-sweep.service';
import { JOB_SWEEP_REVIEWS, REVIEW_EXPIRY_QUEUE_NAME } from './review-expiry.queue';

/**
 * In-process worker for the hourly review-expiry sweep (same Phase-1A
 * pattern as the reservation / accrual / pick-expiration workers).
 * Idempotent: every step of the sweep is guarded, so a re-delivered job
 * cannot double-release stock or double-transition an order.
 */
@Injectable()
export class ReviewExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReviewExpiryWorker.name);
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly sweep: ReviewExpirySweepService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      REVIEW_EXPIRY_QUEUE_NAME,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_SWEEP_REVIEWS) {
          const result = await this.sweep.sweep();
          if (result.expired > 0 || result.failures > 0) {
            this.logger.log(result, 'Early-reservation review expiry sweep complete');
          }
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown review-expiry job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { jobId: job?.id, name: job?.name, err: err?.message },
        'Review expiry job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      this.logger.error({ err: err.message }, 'Review expiry worker error');
    });
    this.logger.log(`Review expiry worker ready (queue=${REVIEW_EXPIRY_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
