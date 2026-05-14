import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import type { EmailDispatchInput } from '../email.types';

export const EMAIL_QUEUE_NAME = 'email';
export const EMAIL_JOB_NAME = 'send';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 }, // 30s, 1m, 2m, 4m, 8m
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
};

@Injectable()
export class EmailQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailQueue.name);
  private queue!: Queue<EmailDispatchInput>;

  constructor(private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<EmailDispatchInput>(EMAIL_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    this.logger.log(`Email queue ready (name=${EMAIL_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }

  /** Enqueues an email send job. Returns the BullMQ job id. */
  async enqueue(input: EmailDispatchInput, opts?: JobsOptions): Promise<string> {
    const job = await this.queue.add(EMAIL_JOB_NAME, input, opts);
    return String(job.id);
  }
}
