import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { EmailDispatchService } from '../services/email-dispatch.service';
import type { EmailDispatchInput, EmailSendResult } from '../email.types';
import { EMAIL_QUEUE_NAME } from './email.queue';

/**
 * In-process BullMQ worker for Phase 1A. Will move to apps/workers when the
 * worker process is split out. Keeps things simple for the auth-module launch:
 * the same node process that handles HTTP also drains the email queue.
 *
 * Failure handling:
 *   - The worker re-throws on FAILED results so BullMQ's default retry/backoff
 *     policy applies (5 attempts, exponential from 30s; configured on the
 *     producer side).
 *   - Successful sends return the EmailSendResult so it ends up on the job's
 *     returnvalue for observability.
 */
@Injectable()
export class EmailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailWorker.name);
  private worker!: Worker<EmailDispatchInput, EmailSendResult>;

  constructor(
    private readonly redis: RedisService,
    private readonly dispatch: EmailDispatchService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<EmailDispatchInput, EmailSendResult>(
      EMAIL_QUEUE_NAME,
      async (job: Job<EmailDispatchInput>): Promise<EmailSendResult> => {
        const result = await this.dispatch.send(job.data);
        if (result.status === 'FAILED') {
          throw new EmailSendFailure(result);
        }
        return result;
      },
      {
        connection: this.redis.createConnection(),
        concurrency: 5,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { jobId: job?.id, templateCode: job?.data?.templateCode, err: err?.message },
        'Email job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      this.logger.error({ err: err.message }, 'Email worker error');
    });

    this.logger.log(`Email worker ready (queue=${EMAIL_QUEUE_NAME}, concurrency=5)`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}

class EmailSendFailure extends Error {
  constructor(public readonly result: EmailSendResult) {
    super(`${result.failureCode ?? 'EMAIL_FAILED'}: ${result.failureMessage ?? 'unknown'}`);
    this.name = 'EmailSendFailure';
  }
}
