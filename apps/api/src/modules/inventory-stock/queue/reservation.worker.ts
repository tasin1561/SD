import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { ReservationCleanupService } from '../services/reservation-cleanup.service';
import { JOB_AUTO_RELEASE, RESERVATION_QUEUE_NAME } from './reservation.queue';

/**
 * In-process worker for the hourly reservation auto-release cron (same
 * Phase 1A pattern as the email / image workers). Idempotent: the sweep
 * releases via StockReservationService, which no-ops on already-terminal
 * rows, so a re-delivered job cannot double-release.
 */
@Injectable()
export class ReservationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReservationWorker.name);
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly cleanup: ReservationCleanupService,
    private readonly workerRole: WorkerRoleService,
  ) {}

  onModuleInit(): void {
    // Only the queue-owning instance starts workers; every other
    // API instance serves HTTP only. See WorkerRoleService.
    if (!this.workerRole.shouldStart(ReservationWorker.name)) return;
    this.worker = new Worker(
      RESERVATION_QUEUE_NAME,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_AUTO_RELEASE) {
          const result = await this.cleanup.sweep();
          this.logger.log(result, 'Reservation auto-release complete');
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown reservation job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { jobId: job?.id, name: job?.name, err: err?.message },
        'Reservation job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      this.logger.error({ err: err.message }, 'Reservation worker error');
    });
    this.logger.log(`Reservation worker ready (queue=${RESERVATION_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
