import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { CourierWhatsappRequestService } from '../../courier-whatsapp/services/courier-whatsapp-request.service';
import {
  JOB_WA_FETCH,
  JOB_WA_SWEEP,
  WHATSAPP_QUEUE_NAME,
  WHATSAPP_SWEEP_CRON,
  type WhatsappReadKind,
} from '../../courier-whatsapp/whatsapp.constants';
import { DelhiveryWhatsappService } from '../services/delhivery-whatsapp.service';

/** A small random pause per tab after each read, so the panel sees a person-ish pace. */
const jitterMs = (): number => 1_000 + Math.floor(Math.random() * 2_000);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * The WhatsApp reader's OWN queue (the portal queue keeps its
 * concurrency 1 for everything else). Concurrency is the
 * `courier.delhivery_whatsapp_parallel` setting, hard-capped at 3 and
 * re-read at every 15-minute sweep, so changing it needs no restart.
 */
@Injectable()
export class DelhiveryWhatsappWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DelhiveryWhatsappWorker.name);
  private queue!: Queue;
  private worker?: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly whatsapp: DelhiveryWhatsappService,
    private readonly requests: CourierWhatsappRequestService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.workerRole.shouldStartPortal(DelhiveryWhatsappWorker.name)) return;
    this.queue = new Queue(WHATSAPP_QUEUE_NAME, { connection: this.redis.createConnection() });
    for (const r of await this.queue.getRepeatableJobs()) {
      await this.queue.removeRepeatableByKey(r.key);
    }
    await this.queue.add(
      JOB_WA_SWEEP,
      {},
      { repeat: { pattern: WHATSAPP_SWEEP_CRON }, removeOnComplete: 20, removeOnFail: 50 },
    );

    this.worker = new Worker(
      WHATSAPP_QUEUE_NAME,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_WA_SWEEP) {
          // Adopt a changed `parallel` setting without a restart.
          if (this.worker) this.worker.concurrency = await this.whatsapp.parallel();
          this.logger.log(await this.whatsapp.sweep(), 'Courier WhatsApp sweep complete');
          return;
        }
        if (job.name !== JOB_WA_FETCH) return;
        const data = job.data as { shipmentId?: unknown; kind?: WhatsappReadKind };
        if (typeof data.shipmentId !== 'string') return;
        const res = await this.whatsapp.fetchOne(data.shipmentId, data.kind ?? 'viewer');
        // A parcel in a live conversation schedules its own next read.
        if (res.nextDelayMs !== null) {
          await this.requests.request(data.shipmentId, {
            kind: 'hot',
            delayMs: res.nextDelayMs,
            idSuffix: '-next',
            ignoreFloor: true,
          });
        }
        if (res.outcome !== 'DISABLED' && res.outcome !== 'SKIPPED') await sleep(jitterMs());
      },
      { connection: this.redis.createConnection(), concurrency: await this.whatsapp.parallel() },
    );
    this.worker.on('failed', (job, err) => {
      void this.issues.reportJobFailure(DelhiveryWhatsappWorker.name, job, err);
    });
    this.worker.on('error', (err) => {
      void this.issues.reportWorkerError(DelhiveryWhatsappWorker.name, err);
    });
    this.logger.log(`Courier WhatsApp reader ready; sweep=${WHATSAPP_SWEEP_CRON}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
  }
}
