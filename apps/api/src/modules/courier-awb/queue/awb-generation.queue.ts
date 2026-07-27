import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export const AWB_GENERATION_QUEUE_NAME = 'courier-awb-generation';
export const JOB_GENERATE_MANIFEST_AWBS = 'generate-manifest-awbs';
export const AWB_BACKOFF_STRATEGY = 'awb-per-attempt';

export interface GenerateManifestAwbsJob {
  manifestId: string;
}

/** Fallbacks when the courier.awb_job_retry_* settings are absent. */
const DEFAULT_RETRY_MAX = 3;
const DEFAULT_BACKOFF_MS: readonly number[] = [1000, 5000, 15000];
const RETRY_MAX_KEY = 'courier.awb_job_retry_max';
const BACKOFF_KEY = 'courier.awb_job_retry_backoff_ms';

/**
 * Module 9 — per-manifest AWB generation BullMQ queue (CUR-2). Retry
 * config is data-driven from system_settings:
 *   - attempts ← courier.awb_job_retry_max (seeded 3)
 *   - per-attempt backoff ← courier.awb_job_retry_backoff_ms
 *     ([1000,5000,15000]) via the custom backoff strategy the worker
 *     registers.
 *
 * jobId is the manifestId — deterministic, so a duplicate enqueue (a
 * re-closed manifest, a retried hook) collapses to ONE job. Combined
 * with AwbGenerationJobService idempotency this makes the whole AWB
 * pipeline safe under retry (CUR-9).
 */
@Injectable()
export class AwbGenerationQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AwbGenerationQueue.name);
  private queue!: Queue<GenerateManifestAwbsJob>;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    const attempts = await this.retryMax();
    const defaultJobOptions: JobsOptions = {
      attempts,
      backoff: { type: AWB_BACKOFF_STRATEGY },
      removeOnComplete: { age: 24 * 60 * 60, count: 500 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 2_000 },
    };
    this.queue = new Queue<GenerateManifestAwbsJob>(AWB_GENERATION_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions,
    });
    this.logger.log(
      `AWB-generation queue ready (name=${AWB_GENERATION_QUEUE_NAME}, attempts=${attempts})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }

  /** Enqueue the per-manifest AWB job. jobId = manifestId (dedup). */
  async enqueueManifest(manifestId: string): Promise<string> {
    const job = await this.queue.add(
      JOB_GENERATE_MANIFEST_AWBS,
      { manifestId },
      { jobId: manifestId },
    );
    return String(job.id);
  }

  private async retryMax(): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: RETRY_MAX_KEY },
      select: { valueInt: true },
    });
    const v = row?.valueInt;
    return typeof v === 'number' && v >= 1 ? v : DEFAULT_RETRY_MAX;
  }

  /** Per-attempt backoff array (ms) — read by the worker to register
   *  the custom backoff strategy. Exposed static so the worker reuses
   *  the same setting key + fallback. */
  static async resolveBackoffMs(prisma: PrismaService): Promise<number[]> {
    const row = await prisma.client.systemSetting.findUnique({
      where: { key: BACKOFF_KEY },
      select: { valueJson: true },
    });
    const raw = row?.valueJson;
    if (Array.isArray(raw) && raw.length > 0 && raw.every((n) => typeof n === 'number' && n >= 0)) {
      return raw as number[];
    }
    return [...DEFAULT_BACKOFF_MS];
  }
}
