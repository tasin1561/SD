import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { DelhiveryWaybillPoolService } from '../services/delhivery-waybill-pool.service';
import { JOB_REFILL_WAYBILLS, WAYBILL_REFILL_QUEUE_NAME } from './waybill-refill.queue';
import { courierActor } from '../../courier-shared/services/courier-credential.service';

const REFILL_ENABLED_SETTING = 'courier.delhivery_waybill_pool_refill_enabled';

/**
 * Keeps the AWB pool above its low-water mark — when anything is drinking
 * from it.
 *
 * ── WHY THIS IS OFF BY DEFAULT ───────────────────────────────────────
 * Nothing consumes the pool today. `DelhiveryAwbService.generateAwb`
 * sends an empty `waybill` and lets Delhivery assign a number inline on
 * the create call, so pooled numbers are never handed out — they simply
 * accumulate. Left enabled with live writes on, this cron would claim
 * hundreds of REAL waybills from the account's allocation every fifteen
 * minutes for a pool nothing reads.
 *
 * The pool is not pointless — it is what MPS needs, because a multi-box
 * consignment requires a pre-fetched waybill PER BOX and Delhivery will
 * not assign those. It is simply ahead of its consumer. So the schedule
 * is gated on `courier.delhivery_waybill_pool_refill_enabled`
 * (default false) and the gate comes off when something drinks.
 *
 * The manual refill on the admin Delhivery console deliberately ignores
 * this setting: filling the pool on purpose, for a test, is a different
 * act from a cron quietly spending an allocation.
 */
@Injectable()
export class WaybillRefillWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WaybillRefillWorker.name);
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly pool: DelhiveryWaybillPoolService,
    private readonly workerRole: WorkerRoleService,
  ) {}

  onModuleInit(): void {
    // Only the queue-owning instance starts workers; every other
    // API instance serves HTTP only. See WorkerRoleService.
    if (!this.workerRole.shouldStart(WaybillRefillWorker.name)) return;
    this.worker = new Worker(
      WAYBILL_REFILL_QUEUE_NAME,
      async (job: Job): Promise<void> => {
        if (job.name !== JOB_REFILL_WAYBILLS) {
          this.logger.warn({ name: job.name }, 'Unknown waybill-refill job; ignoring');
          return;
        }
        if (!(await this.refillEnabled())) {
          // Silent: this is the default state, and a warning every fifteen
          // minutes about a deliberate configuration would train people to
          // ignore this worker's logs.
          return;
        }
        try {
          const result = await this.pool.refillIfNeeded(
            courierActor.runner('waybill-refill', job.id),
          );
          if (result.fetched > 0) {
            this.logger.log(result, 'Waybill pool topped up');
          }
        } catch (err) {
          // The most likely causes are both operator-visible states, not
          // bugs: live writes are still switched off, or the rate budget
          // is spent. Neither should crash the worker loop.
          this.logger.warn(
            { err: (err as Error).message },
            'Waybill refill could not run — pool may run dry, which stalls manifesting',
          );
        }
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );

    this.worker.on('error', (err) => {
      this.logger.error({ err: err.message }, 'Waybill refill worker error');
    });
    this.logger.log(`Waybill refill worker ready (queue=${WAYBILL_REFILL_QUEUE_NAME})`);
  }

  /** Fails CLOSED: an unreadable or absent setting means "do not spend". */
  private async refillEnabled(): Promise<boolean> {
    try {
      const row = await this.prisma.client.systemSetting.findUnique({
        where: { key: REFILL_ENABLED_SETTING },
        select: { valueBoolean: true },
      });
      return row?.valueBoolean === true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
