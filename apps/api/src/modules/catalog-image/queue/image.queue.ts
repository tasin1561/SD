import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export const IMAGE_QUEUE_NAME = 'catalog-image';
export const JOB_GENERATE_THUMBNAIL = 'generate-thumbnail';
export const JOB_DELETE_OBJECTS = 'delete-objects';
export const JOB_ORPHAN_SWEEP = 'orphan-sweep';
/** Daily at 03:15 UTC. */
export const ORPHAN_SWEEP_CRON = '15 3 * * *';

export interface GenerateThumbnailJob {
  imageId: string;
}

export interface DeleteObjectsJob {
  keys: string[];
  sellerId: string;
  reason: string;
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 15_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
};

@Injectable()
export class ImageQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImageQueue.name);
  private queue!: Queue;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(IMAGE_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    // Register the daily orphan-sweep as a repeatable job. Stable jobId
    // means re-registering on every boot is idempotent (BullMQ dedupes
    // the repeat schedule by key).
    await this.queue.add(
      JOB_ORPHAN_SWEEP,
      {},
      {
        repeat: { pattern: ORPHAN_SWEEP_CRON },
        jobId: 'orphan-sweep',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );
    this.logger.log(
      `Image queue ready (name=${IMAGE_QUEUE_NAME}); orphan-sweep cron=${ORPHAN_SWEEP_CRON}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }

  async enqueueThumbnail(data: GenerateThumbnailJob): Promise<string> {
    const job = await this.queue.add(JOB_GENERATE_THUMBNAIL, data);
    return String(job.id);
  }

  async enqueueDelete(data: DeleteObjectsJob): Promise<string> {
    const job = await this.queue.add(JOB_DELETE_OBJECTS, data);
    return String(job.id);
  }

  /** Used by the orphan-cleanup cron (commit 12) to register a repeatable. */
  get raw(): Queue {
    return this.queue;
  }
}
