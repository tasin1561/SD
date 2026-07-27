import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import type { OutboundWebhookJobInput } from '../types';

export const OUTBOUND_WEBHOOK_QUEUE_NAME = 'outbound-webhook';
export const OUTBOUND_WEBHOOK_JOB_NAME = 'send';

/**
 * BullMQ retry policy per CLAUDE.md outbound webhook rules:
 *   - 5 attempts, exponential backoff (30s, 5m, 30m, 6h, 24h-ish).
 *   - BullMQ exponential = delay * 2^(attempt - 1) so a 30s base
 *     gives 30s, 1m, 2m, 4m, 8m — too aggressive. We override via
 *     the listener supplying per-attempt delays.
 *   - removeOnComplete keeps the queue lean; removeOnFail keeps
 *     a 7-day window for forensic inspection (matches email).
 */
const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 5_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 10_000 },
};

@Injectable()
export class OutboundWebhookQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboundWebhookQueue.name);
  private queue!: Queue<OutboundWebhookJobInput>;

  constructor(private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<OutboundWebhookJobInput>(OUTBOUND_WEBHOOK_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    this.logger.log(`Outbound-webhook queue ready (name=${OUTBOUND_WEBHOOK_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }

  /** Enqueues an outbound webhook send. Returns the BullMQ job id. */
  async enqueue(input: OutboundWebhookJobInput, opts?: JobsOptions): Promise<string> {
    const job = await this.queue.add(OUTBOUND_WEBHOOK_JOB_NAME, input, opts);
    return String(job.id);
  }
}
