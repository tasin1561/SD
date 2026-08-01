import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { PackBoxService } from '../services/pack-box.service';
import { JOB_SWEEP_PACK_BOXES, PACK_BOX_EXPIRY_QUEUE_NAME } from './pack-box-expiry.queue';

/**
 * In-process worker for the pack-box expiry sweep (same Phase-1A shape
 * as the pick-expiration / reservation / accrual workers).
 *
 * Idempotent by construction: `expireOverdue` claims each box with a
 * guarded `updateMany` on `(id, status = OPEN)`, so a re-delivered job,
 * a duplicate timer, or a box closed a moment ago can never be
 * double-expired.
 */
@Injectable()
export class PackBoxExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PackBoxExpiryWorker.name);
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly boxes: PackBoxService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      PACK_BOX_EXPIRY_QUEUE_NAME,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_SWEEP_PACK_BOXES) {
          const result = await this.boxes.expireOverdue();
          // Only worth a line when it actually reclaimed something —
          // a sweep that finds nothing every five minutes is noise.
          if (result.expired > 0) {
            this.logger.log(result, 'Pack-box expiry sweep reclaimed abandoned boxes');
          }
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown pack-box expiry job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { jobId: job?.id, name: job?.name, err: err?.message },
        'Pack-box expiry job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      this.logger.error({ err: err.message }, 'Pack-box expiry worker error');
    });
    this.logger.log(`Pack-box expiry worker ready (queue=${PACK_BOX_EXPIRY_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
