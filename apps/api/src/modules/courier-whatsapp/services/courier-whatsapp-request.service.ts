import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import {
  JOB_WA_FETCH,
  PRIORITY_EVENT,
  PRIORITY_HOT,
  PRIORITY_SWEEP,
  WHATSAPP_COURIER,
  WHATSAPP_MANUAL_MIN_GAP_MS,
  WHATSAPP_QUEUE_NAME,
  WHATSAPP_SETTING_KEY,
  type WhatsappReadKind,
} from '../whatsapp.constants';

export type WhatsappRequestOutcome =
  | { readonly queued: true }
  | { readonly queued: false; readonly reason: 'DISABLED' | 'NOT_DELHIVERY' | 'TOO_SOON' };

export interface WhatsappRequestOptions {
  readonly kind?: WhatsappReadKind;
  /** Delay the read (the 2 h follow-up after a failed attempt). */
  readonly delayMs?: number;
  /** Skip the per-parcel 2-minute floor (a delayed follow-up). */
  readonly ignoreFloor?: boolean;
  /** Distinct jobId suffix, so the follow-up does not collide with the immediate read. */
  readonly idSuffix?: string;
}

const PRIORITY: Record<WhatsappReadKind, number> = {
  hot: PRIORITY_HOT,
  event: PRIORITY_EVENT,
  viewer: PRIORITY_EVENT,
  sweep: PRIORITY_SWEEP,
};

/**
 * The API's half: put "read this parcel's WhatsApp window" on the
 * WhatsApp worker's own queue. The browser never runs here, and Delhivery
 * is never called inside an HTTP request.
 */
@Injectable()
export class CourierWhatsappRequestService implements OnModuleDestroy {
  private readonly logger = new Logger(CourierWhatsappRequestService.name);
  private queue?: Queue;
  private enabledCache: { at: number; value: boolean } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async isEnabled(): Promise<boolean> {
    // A scan can arrive hundreds of times an hour; one setting read per 30 s is plenty.
    if (this.enabledCache !== null && Date.now() - this.enabledCache.at < 30_000) {
      return this.enabledCache.value;
    }
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: WHATSAPP_SETTING_KEY },
      select: { valueBoolean: true },
    });
    const value = row?.valueBoolean === true;
    this.enabledCache = { at: Date.now(), value };
    return value;
  }

  async request(
    shipmentId: string,
    opts: WhatsappRequestOptions = {},
  ): Promise<WhatsappRequestOutcome> {
    if (!(await this.isEnabled())) return { queued: false, reason: 'DISABLED' };
    const ship = await this.prisma.client.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        courierCode: true,
        awbNumber: true,
        courierWhatsappCheck: { select: { lastAttemptAt: true } },
      },
    });
    if (ship === null || ship.courierCode !== WHATSAPP_COURIER || ship.awbNumber === null) {
      return { queued: false, reason: 'NOT_DELHIVERY' };
    }
    const last = ship.courierWhatsappCheck?.lastAttemptAt;
    if (
      opts.ignoreFloor !== true &&
      last !== undefined &&
      Date.now() - last.getTime() < WHATSAPP_MANUAL_MIN_GAP_MS
    ) {
      return { queued: false, reason: 'TOO_SOON' };
    }
    const kind = opts.kind ?? 'viewer';
    this.queue ??= new Queue(WHATSAPP_QUEUE_NAME, { connection: this.redis.createConnection() });
    // jobId dedupes a second request while the first is still waiting.
    await this.queue.add(
      JOB_WA_FETCH,
      { shipmentId, kind },
      {
        jobId: `wa-${shipmentId}${opts.idSuffix ?? ''}`,
        priority: PRIORITY[kind],
        ...(opts.delayMs !== undefined ? { delay: opts.delayMs } : {}),
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
    this.logger.log({ shipmentId, kind }, 'WhatsApp read queued');
    return { queued: true };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }
}
