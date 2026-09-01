import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { OutboundWebhookDispatchService } from '../services/outbound-webhook-dispatch.service';
import type { OutboundWebhookJobInput, WebhookSendResult } from '../types';
import { OUTBOUND_WEBHOOK_QUEUE_NAME } from './outbound-webhook.queue';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';

class WebhookSendFailure extends Error {
  constructor(public readonly result: WebhookSendResult) {
    super(result.errorMessage ?? 'Webhook delivery failed');
  }
}

@Injectable()
export class OutboundWebhookWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboundWebhookWorker.name);
  private worker!: Worker<OutboundWebhookJobInput, WebhookSendResult>;

  constructor(
    private readonly redis: RedisService,
    private readonly dispatch: OutboundWebhookDispatchService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  onModuleInit(): void {
    // Only the queue-owning instance starts workers; every other
    // API instance serves HTTP only. See WorkerRoleService.
    if (!this.workerRole.shouldStart(OutboundWebhookWorker.name)) return;
    this.worker = new Worker<OutboundWebhookJobInput, WebhookSendResult>(
      OUTBOUND_WEBHOOK_QUEUE_NAME,
      async (job: Job<OutboundWebhookJobInput>): Promise<WebhookSendResult> => {
        // Re-derive attemptNumber from BullMQ's own counter so the
        // delivery row's attemptNumber stays accurate across retries.
        const attempt = (job.attemptsMade ?? 0) + 1;
        const result = await this.dispatch.deliver({
          ...job.data,
          attemptNumber: attempt,
        });
        if (result.status === 'FAILED') {
          // Throwing makes BullMQ apply its retry/backoff. Successful
          // deliveries return the result for observability.
          throw new WebhookSendFailure(result);
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
        {
          jobId: job?.id,
          endpointId: job?.data?.endpointId,
          eventType: job?.data?.eventType,
          attemptsMade: job?.attemptsMade,
          err: err?.message,
        },
        'Outbound webhook job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      // Say it where somebody will see it: a worker erroring
      // breaks no screen, the work simply stops happening.
      void this.issues.reportWorkerError(OutboundWebhookWorker.name, err);
      this.logger.error({ err: err.message }, 'Outbound webhook worker error');
    });

    this.logger.log(
      `Outbound-webhook worker ready (queue=${OUTBOUND_WEBHOOK_QUEUE_NAME}, concurrency=5)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
