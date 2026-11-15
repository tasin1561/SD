import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import {
  JOB_PORTAL_WHATSAPP_FETCH,
  PORTAL_QUEUE_NAME,
  WHATSAPP_COURIER,
  WHATSAPP_MANUAL_MIN_GAP_MS,
  WHATSAPP_SETTING_KEY,
} from '../whatsapp.constants';

export type WhatsappRequestOutcome =
  | { readonly queued: true }
  | { readonly queued: false; readonly reason: 'DISABLED' | 'NOT_DELHIVERY' | 'TOO_SOON' };

/**
 * The API's half: put "read this parcel's WhatsApp window" on the portal
 * worker's own queue. The browser never runs here.
 */
@Injectable()
export class CourierWhatsappRequestService implements OnModuleDestroy {
  private readonly logger = new Logger(CourierWhatsappRequestService.name);
  private queue?: Queue;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async isEnabled(): Promise<boolean> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: WHATSAPP_SETTING_KEY },
      select: { valueBoolean: true },
    });
    return row?.valueBoolean === true;
  }

  async request(shipmentId: string): Promise<WhatsappRequestOutcome> {
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
    if (last !== undefined && Date.now() - last.getTime() < WHATSAPP_MANUAL_MIN_GAP_MS) {
      return { queued: false, reason: 'TOO_SOON' };
    }
    this.queue ??= new Queue(PORTAL_QUEUE_NAME, { connection: this.redis.createConnection() });
    // jobId dedupes a second click while the first is still waiting.
    await this.queue.add(
      JOB_PORTAL_WHATSAPP_FETCH,
      { shipmentId },
      { jobId: `wa-${shipmentId}`, attempts: 1, removeOnComplete: true, removeOnFail: 50 },
    );
    this.logger.log({ shipmentId }, 'WhatsApp refresh queued');
    return { queued: true };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }
}
