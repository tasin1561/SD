import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { WebhookPayloadRetentionService } from '../services/webhook-payload-retention.service';
import {
  JOB_SWEEP_WEBHOOK_PAYLOADS,
  WEBHOOK_RETENTION_QUEUE_NAME,
} from './webhook-retention.queue';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';

/**
 * In-process worker for the daily courier-payload retention sweep.
 * Idempotent by construction — the sweep only selects rows that still
 * carry a payload, so a retried job re-clears nothing.
 */
@Injectable()
export class WebhookRetentionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookRetentionWorker.name);
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly retention: WebhookPayloadRetentionService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  onModuleInit(): void {
    // Only the queue-owning instance starts workers; every other
    // API instance serves HTTP only. See WorkerRoleService.
    if (!this.workerRole.shouldStart(WebhookRetentionWorker.name)) return;
    this.worker = new Worker(
      WEBHOOK_RETENTION_QUEUE_NAME,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_SWEEP_WEBHOOK_PAYLOADS) {
          const result = await this.retention.sweep();
          this.logger.log(result, 'Webhook payload retention sweep complete');
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown webhook-retention job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      // Only once BullMQ has stopped retrying: an exhausted job is
      // work that definitively did not happen.
      void this.issues.reportJobFailure(WebhookRetentionWorker.name, job, err);
      this.logger.warn(
        { jobId: job?.id, err: err?.message },
        'Webhook retention job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      // Say it where somebody will see it: a worker erroring
      // breaks no screen, the work simply stops happening.
      void this.issues.reportWorkerError(WebhookRetentionWorker.name, err);
      this.logger.error({ err: err.message }, 'Webhook retention worker error');
    });
    this.logger.log(`Webhook retention worker ready (queue=${WEBHOOK_RETENTION_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
