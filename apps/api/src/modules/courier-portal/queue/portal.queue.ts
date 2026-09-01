import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { PortalCanaryService } from '../services/portal-canary.service';
import { PortalDispatcherService } from '../services/portal-dispatcher.service';
import { PortalSessionService } from '../services/portal-session.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';

export const PORTAL_QUEUE = 'courier-portal';
export const JOB_PORTAL_DISPATCH = 'portal-dispatch';
export const JOB_PORTAL_CANARY = 'portal-canary';

/**
 * The canary's timezone. Explicit for the same reason the NDR runner's is:
 * the droplet runs UTC, so `0 3 * * *` without this fires at 09:00 Dhaka
 * (UTC+6) — the start of the working day, when a canary that raises and
 * resolves a ticket is competing with real operators on the same portal.
 */
export const PORTAL_TIMEZONE = 'Asia/Dhaka';

/**
 * Wakes the portal worker.
 *
 * This queue exists ONLY in the portal worker process. There is no
 * `WorkerRoleService` check because there is no other process to compete
 * with: `CourierPortalModule` is not reachable from `AppModule`, so the
 * API never registers it. That is enforced by
 * `portal-worker-isolation.spec.ts`.
 *
 * `concurrency: 1` is not a tuning choice. Two browsers sharing one
 * `storageState` file race on write, and the loser silently produces a
 * session that re-authenticates next run — a symptom nobody traces back
 * to concurrency.
 */
@Injectable()
export class PortalQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PortalQueue.name);
  private queue!: Queue;
  private worker?: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly dispatcher: PortalDispatcherService,
    private readonly canary: PortalCanaryService,
    private readonly session: PortalSessionService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(PORTAL_QUEUE, { connection: this.redis.createConnection() });
    for (const r of await this.queue.getRepeatableJobs()) {
      await this.queue.removeRepeatableByKey(r.key);
    }

    // Every 15 minutes. The pacing service is what makes the work slow;
    // the tick only has to be more frequent than the queue fills.
    await this.queue.add(
      JOB_PORTAL_DISPATCH,
      {},
      { repeat: { pattern: '*/15 * * * *' }, removeOnComplete: 20, removeOnFail: 50 },
    );
    await this.queue.add(
      JOB_PORTAL_CANARY,
      {},
      {
        repeat: { pattern: '0 3 * * *', tz: PORTAL_TIMEZONE },
        removeOnComplete: 20,
        removeOnFail: 50,
      },
    );

    // Only the queue-owning instance starts workers; every other
    // API instance serves HTTP only. See WorkerRoleService (SCALE-1).
    if (!this.workerRole.shouldStartPortal(PortalQueue.name)) return;
    this.worker = new Worker(
      PORTAL_QUEUE,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_PORTAL_DISPATCH) {
          await this.dispatcher.runCycle();
          return;
        }
        if (job.name === JOB_PORTAL_CANARY) {
          await this.canary.run();
          return;
        }
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      // Only once BullMQ has stopped retrying: an exhausted job is
      // work that definitively did not happen.
      void this.issues.reportJobFailure(PortalQueue.name, job, err);
      this.logger.warn({ jobId: job?.id, name: job?.name, err: err?.message }, 'Portal job failed');
    });

    this.logger.log(`Portal worker ready (queue=${PORTAL_QUEUE}, canary tz=${PORTAL_TIMEZONE})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
    // Persist storageState so the next run does not have to log in.
    await this.session.close();
  }
}
