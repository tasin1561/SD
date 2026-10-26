import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export const IMAGE_QUEUE_NAME = 'catalog-image';
export const JOB_GENERATE_THUMBNAIL = 'generate-thumbnail';
export const JOB_DELETE_OBJECTS = 'delete-objects';
export const JOB_ORPHAN_SWEEP = 'orphan-sweep';
/** A picture named by URL in a product CSV, fetched after the row commits. */
export const JOB_FETCH_IMAGE = 'fetch-image';
/** Daily at 03:15 UTC. */
export const ORPHAN_SWEEP_CRON = '15 3 * * *';

export interface GenerateThumbnailJob {
  imageId: string;
}

/**
 * One picture to fetch and store, from a URL a seller put in a CSV.
 *
 * A JOB rather than part of the import, because an upload of four
 * hundred rows would otherwise make four hundred outbound requests
 * inside one HTTP handler and time out long before it finished — and a
 * picture that cannot be fetched must not fail the product row that
 * named it. The variant exists either way; this adds its photograph
 * when it can.
 */
export interface FetchImageJob {
  sellerId: string;
  variantId: string;
  url: string;
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

  async enqueueFetchImage(data: FetchImageJob): Promise<string> {
    // Keyed on the variant: a CSV re-uploaded with the same row must
    // not queue the same picture twice. BullMQ returns the existing job
    // for a jobId it already holds.
    const job = await this.queue.add(JOB_FETCH_IMAGE, data, {
      jobId: `fetch-image:${data.variantId}`,
    });
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
