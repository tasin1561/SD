import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export const ADDRESS_CHECK_QUEUE_NAME = 'address-check';
/** Re-ask about an address whose check could not be made. */
export const JOB_RETRY_CHECK = 'retry-check';
/** Tell Solustation what the courier did with an address. */
export const JOB_SEND_FEEDBACK = 'send-feedback';
/** Every 12 minutes — inside the owner's "every 10-15 min" window. */
export const FEEDBACK_SWEEP_CRON = '*/12 * * * *';
/** Hourly: the unavailable checks whose turn has come. */
export const RETRY_SWEEP_CRON = '7 * * * *';

export interface RetryCheckJob {
  /** Nothing else: the row holds the address, and the row is the truth. */
  referenceId: string;
}

/**
 * Six tries over roughly an hour (brief §3d), as explicit per-attempt
 * delays rather than BullMQ's exponential.
 *
 * Exponential from a 60s base gives 1m, 2m, 4m, 8m, 16m — which spends
 * four of its six attempts inside the first eight minutes and the last
 * one half an hour later. An address check fails because THEIR service
 * is down, and a service that is down at minute one is usually still
 * down at minute two; the attempts are worth more spread across the
 * hour than bunched at the start of it.
 */
export const RETRY_BACKOFF_MS: readonly number[] = [
  60_000, // 1m
  180_000, // 3m
  420_000, // 7m
  900_000, // 15m
  1_500_000, // 25m
  2_400_000, // 40m
];

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: RETRY_BACKOFF_MS.length,
  backoff: { type: 'address-check-backoff' },
  removeOnComplete: { age: 24 * 60 * 60, count: 5_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 10_000 },
};

/**
 * The address check's own queue: retrying a check that could not be
 * made, and telling Solustation what the courier did.
 *
 * Both are things that must never happen inside a request. A retry runs
 * while nobody is watching, and the feedback sweep reads scans that
 * were recorded hours ago — neither has anybody waiting on it, and
 * neither may delay an order or a courier update by a millisecond.
 */
@Injectable()
export class AddressCheckQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AddressCheckQueue.name);
  private queue!: Queue;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(ADDRESS_CHECK_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    this.logger.log(`Address-check queue ready (${ADDRESS_CHECK_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  /**
   * Queue one re-ask.
   *
   * Keyed on the reference, so a row swept twice — by the hourly sweep
   * and by a check that failed a moment ago — is ONE job rather than
   * two racing to write the same answer. BullMQ returns the existing
   * job for a jobId it already holds, which is the behaviour wanted
   * here and a trap elsewhere: it returns the OLD job without
   * rescheduling it.
   */
  async enqueueRetry(data: RetryCheckJob): Promise<string> {
    const job = await this.queue.add(JOB_RETRY_CHECK, data, {
      jobId: `retry:${data.referenceId}`,
    });
    return String(job.id);
  }

  /** The repeatables. Registered on boot; BullMQ dedupes by name. */
  async registerSweeps(): Promise<void> {
    await this.queue.add(
      JOB_SEND_FEEDBACK,
      {},
      { repeat: { pattern: FEEDBACK_SWEEP_CRON }, jobId: 'feedback-sweep' },
    );
    await this.queue.add(
      JOB_RETRY_CHECK,
      { referenceId: '' },
      { repeat: { pattern: RETRY_SWEEP_CRON }, jobId: 'retry-sweep' },
    );
  }

  get raw(): Queue {
    return this.queue;
  }
}
