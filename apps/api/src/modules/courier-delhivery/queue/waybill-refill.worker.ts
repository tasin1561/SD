import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { DelhiveryWaybillPoolService } from '../services/delhivery-waybill-pool.service';
import { JOB_REFILL_WAYBILLS, WAYBILL_REFILL_QUEUE_NAME } from './waybill-refill.queue';

/**
 * Keeps the AWB pool above its low-water mark.
 *
 * A dry pool stalls manifesting and CANNOT be fixed inline — Delhivery
 * allows five bulk fetches per five minutes, so a shipment that finds the
 * pool empty has to wait for this job rather than fetching its own
 * number. That is why the refill runs on a schedule and logs loudly when
 * it cannot do its job.
 */
@Injectable()
export class WaybillRefillWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WaybillRefillWorker.name);
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly pool: DelhiveryWaybillPoolService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      WAYBILL_REFILL_QUEUE_NAME,
      async (job: Job): Promise<void> => {
        if (job.name !== JOB_REFILL_WAYBILLS) {
          this.logger.warn({ name: job.name }, 'Unknown waybill-refill job; ignoring');
          return;
        }
        try {
          const result = await this.pool.refillIfNeeded();
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

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
