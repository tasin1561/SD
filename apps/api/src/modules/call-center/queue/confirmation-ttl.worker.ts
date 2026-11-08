import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { ConfirmationTtlSweeperService } from '../services/confirmation-ttl-sweeper.service';
import { CONFIRMATION_TTL_QUEUE_NAME, JOB_SWEEP_CONFIRMATION_TTL } from './confirmation-ttl.queue';

/**
 * Auto-confirms orders whose no-call TTL has passed. The sweep is
 * idempotent: the claim is a guarded update, so a BullMQ retry or a
 * duplicate delivery cannot confirm an order twice.
 */
@Injectable()
export class ConfirmationTtlWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConfirmationTtlWorker.name);
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly sweeper: ConfirmationTtlSweeperService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  onModuleInit(): void {
    // SCALE-1: only the queue-owning instance runs workers.
    if (!this.workerRole.shouldStart(ConfirmationTtlWorker.name)) return;
    this.worker = new Worker(
      CONFIRMATION_TTL_QUEUE_NAME,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_SWEEP_CONFIRMATION_TTL) {
          const r = await this.sweeper.sweep();
          if (r.confirmed + r.queued > 0) this.logger.log(r, 'Confirmation TTL sweep');
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown confirmation-ttl job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      void this.issues.reportJobFailure(ConfirmationTtlWorker.name, job, err);
      this.logger.warn({ jobId: job?.id, err: err?.message }, 'Confirmation-TTL job failed');
    });
    this.worker.on('error', (err) => {
      void this.issues.reportWorkerError(ConfirmationTtlWorker.name, err);
      this.logger.error({ err: err.message }, 'Confirmation-TTL worker error');
    });
    this.logger.log('Confirmation-TTL worker started');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
