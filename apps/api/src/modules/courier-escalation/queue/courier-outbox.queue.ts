import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { CourierOutboxDispatcherService } from '../services/courier-outbox-dispatcher.service';
import { CourierOutboxReconcilerService } from '../services/courier-outbox-reconciler.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';

export const COURIER_OUTBOX_QUEUE = 'courier-outbox';
export const JOB_DISPATCH = 'outbox-dispatch';
export const JOB_RECONCILE = 'outbox-reconcile';

/**
 * Wakes the outbox up. It does not decide anything.
 *
 * The row's STATE decides what may happen, which is why this is a plain
 * tick rather than a job-per-message: a BullMQ job that carried the
 * message would retry on failure, and retrying a courier write is the
 * one thing that must never happen automatically.
 *
 * Dispatch every minute (cheap — it claims nothing unless the mode
 * allows), reconcile every five (it makes network reads, and an unknown
 * that is five minutes old is no worse than one that is one minute old).
 */
@Injectable()
export class CourierOutboxQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CourierOutboxQueue.name);
  private queue!: Queue;
  private worker?: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly workerRole: WorkerRoleService,
    private readonly dispatcher: CourierOutboxDispatcherService,
    private readonly reconciler: CourierOutboxReconcilerService,
    private readonly issues: SystemIssueService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(COURIER_OUTBOX_QUEUE, { connection: this.redis.createConnection() });

    for (const r of await this.queue.getRepeatableJobs()) {
      await this.queue.removeRepeatableByKey(r.key);
    }
    await this.queue.add(
      JOB_DISPATCH,
      {},
      { repeat: { pattern: '* * * * *' }, removeOnComplete: 20, removeOnFail: 50 },
    );
    await this.queue.add(
      JOB_RECONCILE,
      {},
      { repeat: { pattern: '*/5 * * * *' }, removeOnComplete: 20, removeOnFail: 50 },
    );

    // SCALE-1: only the queue-owning instance runs workers. Two
    // dispatchers would each claim items — the claim guard stops a
    // double-send, but the second process would still be doing work
    // nobody asked for.
    if (!this.workerRole.shouldStart(CourierOutboxQueue.name)) {
      this.logger.log('Courier outbox queue registered; worker not started on this instance');
      return;
    }

    this.worker = new Worker(
      COURIER_OUTBOX_QUEUE,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_DISPATCH) {
          await this.dispatcher.runCycle();
          return;
        }
        if (job.name === JOB_RECONCILE) {
          await this.reconciler.reconcile();
          return;
        }
      },
      // ONE at a time: the dispatcher and the reconciler both touch the
      // same rows, and a reconcile running against an item mid-dispatch
      // would be reading a state that is about to change.
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      // Only once BullMQ has stopped retrying: an exhausted job is
      // work that definitively did not happen.
      void this.issues.reportJobFailure(CourierOutboxQueue.name, job, err);
      this.logger.warn(
        { jobId: job?.id, name: job?.name, err: err?.message },
        'Courier outbox job failed',
      );
    });
    this.logger.log(`Courier outbox worker ready (queue=${COURIER_OUTBOX_QUEUE})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
  }
}
