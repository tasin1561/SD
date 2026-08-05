import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { wafAwareBackoff } from '../../courier-delhivery/util/waf-backoff';
import { NdrReconciliationService } from '../services/ndr-reconciliation.service';
import { NdrRunnerService } from '../services/ndr-runner.service';
import { NdrUplPollerService } from '../services/ndr-upl-poller.service';
import { JOB_NIGHTLY_RUN, JOB_POLL_UPLS, JOB_RECONCILE, NDR_QUEUE_NAME } from './ndr.queue';

/** Matches the AWB job's schedule; the WAF branch overrides it. */
const BACKOFF_MS = [1_000, 5_000, 15_000];

@Injectable()
export class NdrWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NdrWorker.name);
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly workerRole: WorkerRoleService,
    private readonly runner: NdrRunnerService,
    private readonly poller: NdrUplPollerService,
    private readonly reconciliation: NdrReconciliationService,
  ) {}

  onModuleInit(): void {
    // SCALE-1: only the queue-owning instance starts workers. Without
    // this, a second API process fires the nightly batch a second time —
    // and this batch sends vans.
    if (!this.workerRole.shouldStart(NdrWorker.name)) return;

    this.worker = new Worker(
      NDR_QUEUE_NAME,
      async (job: Job): Promise<void> => {
        switch (job.name) {
          case JOB_NIGHTLY_RUN: {
            const s = await this.runner.run();
            this.logger.log(s, 'NDR nightly run complete');
            return;
          }
          case JOB_POLL_UPLS: {
            const s = await this.poller.poll();
            if (s.polled > 0) this.logger.log(s, 'NDR UPL poll complete');
            return;
          }
          case JOB_RECONCILE: {
            const s = await this.reconciliation.reconcile();
            this.logger.log(s, 'NDR reconciliation complete');
            return;
          }
          default:
            this.logger.warn({ name: job.name }, 'Unknown NDR job; ignoring');
        }
      },
      {
        connection: this.redis.createConnection(),
        // ONE at a time. These jobs read and write the same rows, and a
        // concurrent nightly run and poll settling the same request is a
        // race with a van at the end of it.
        concurrency: 1,
        settings: { backoffStrategy: wafAwareBackoff(BACKOFF_MS) },
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.warn({ jobId: job?.id, name: job?.name, err: err?.message }, 'NDR job failed');
    });
    this.logger.log(`NDR worker ready (queue=${NDR_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
