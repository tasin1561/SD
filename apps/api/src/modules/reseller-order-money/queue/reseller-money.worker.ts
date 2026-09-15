import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { ResellerOrderMoneyService } from '../services/reseller-order-money.service';
import { JOB_SWEEP_RESELLER_CREDITS, RESELLER_MONEY_QUEUE_NAME } from './reseller-money.queue';

/**
 * RS-6 phase 3c — in-process worker for the reseller credit sweep. Idempotent:
 * every credit is claimed DUE → CREDITED under the seller's WALLET lock in the
 * transaction that writes it, so a re-delivered job writes nothing twice.
 */
@Injectable()
export class ResellerMoneyWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResellerMoneyWorker.name);
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly money: ResellerOrderMoneyService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  onModuleInit(): void {
    // SCALE-1: only the queue-owning instance starts workers.
    if (!this.workerRole.shouldStart(ResellerMoneyWorker.name)) return;
    this.worker = new Worker(
      RESELLER_MONEY_QUEUE_NAME,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_SWEEP_RESELLER_CREDITS) {
          const result = await this.money.sweepDue();
          if (result.scanned > 0) this.logger.log(result, 'Reseller credit sweep complete');
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown reseller-money job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      void this.issues.reportJobFailure(ResellerMoneyWorker.name, job, err);
    });
    this.worker.on('error', (err) => {
      void this.issues.reportWorkerError(ResellerMoneyWorker.name, err);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
