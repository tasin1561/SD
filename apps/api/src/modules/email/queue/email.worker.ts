import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { EmailDispatchService } from '../services/email-dispatch.service';
import { EmailProviderRouter } from '../services/email-provider-router.service';
import type { EmailDispatchInput, EmailSendResult } from '../email.types';
import { EMAIL_QUEUE_NAME } from './email.queue';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';

/**
 * THE QUEUE'S LIMITER IS NO LONGER A PROVIDER'S LIMIT.
 *
 * It was pinned at Resend's 2/s, which was right while Resend was the only
 * provider and wrong the moment SES — which starts at 14/s — joined it:
 * left at 2 a busy day drains at a quarter speed, and a single number
 * cannot express two providers anyway.
 *
 * So the queue limiter is the ceiling of the FASTEST live provider (the
 * queue stops being the bottleneck) and `EmailProviderRouter` paces each
 * provider to its OWN documented rate underneath it. With SES
 * unconfigured that ceiling is Resend's 2/s — byte-identical to the
 * constant this replaced.
 */

/** Parallel in-flight sends. Above the per-second cap on purpose: the limiter
 *  paces the provider, concurrency just keeps the pipe full while it does. */
const EMAIL_CONCURRENCY = 5;

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
 *
 * Rate limiting: the provider caps requests per second, and a single order
 * moving through its lifecycle fans out to seven emails (seller + customer at
 * confirm / dispatch / delivered, plus the customer at out-for-delivery). A
 * handful of orders confirming together would burst straight past the cap,
 * and a 429 here is not harmless — it marks the notification FAILED and burns
 * a BullMQ attempt on something that was only ever a pacing problem. The
 * limiter is Redis-backed, so it holds across every API instance rather than
 * per process.
 */
@Injectable()
export class EmailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailWorker.name);
  private worker!: Worker<EmailDispatchInput, EmailSendResult>;

  constructor(
    private readonly redis: RedisService,
    private readonly dispatch: EmailDispatchService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
    private readonly router: EmailProviderRouter,
  ) {}

  onModuleInit(): void {
    // Only the queue-owning instance starts workers; every other
    // API instance serves HTTP only. See WorkerRoleService.
    if (!this.workerRole.shouldStart(EmailWorker.name)) return;
    const maxPerSecond = this.router.queueRateLimitPerSecond;
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
        concurrency: EMAIL_CONCURRENCY,
        limiter: { max: maxPerSecond, duration: 1_000 },
      },
    );

    this.worker.on('failed', (job, err) => {
      // Only once BullMQ has stopped retrying: an exhausted job is
      // work that definitively did not happen.
      void this.issues.reportJobFailure(EmailWorker.name, job, err);
      this.logger.warn(
        { jobId: job?.id, templateCode: job?.data?.templateCode, err: err?.message },
        'Email job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      // Say it where somebody will see it: a worker erroring
      // breaks no screen, the work simply stops happening.
      void this.issues.reportWorkerError(EmailWorker.name, err);
      this.logger.error({ err: err.message }, 'Email worker error');
    });

    this.logger.log(
      `Email worker ready (queue=${EMAIL_QUEUE_NAME}, concurrency=${EMAIL_CONCURRENCY}, max=${maxPerSecond}/s)`,
    );
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
