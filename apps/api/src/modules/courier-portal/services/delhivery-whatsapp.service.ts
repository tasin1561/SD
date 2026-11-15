import { Injectable, Logger } from '@nestjs/common';
import { ShipmentStatus, TrackingEventType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  WHATSAPP_COURIER,
  WHATSAPP_DEBOUNCE_MS,
  WHATSAPP_SETTING_KEY,
  WHATSAPP_TAIL_MS,
} from '../../courier-whatsapp/whatsapp.constants';
import {
  DelhiveryWhatsappPage,
  bubbleHashes,
  parseSentAt,
  type WhatsappRead,
} from '../pages/delhivery-whatsapp.page';
import { PortalSessionService } from './portal-session.service';

export type WhatsappFetchOutcome =
  | 'DISABLED'
  | 'SKIPPED'
  | 'OK'
  | 'NO_BUTTON'
  | 'UNREADABLE'
  | 'FAILED';

/** Scans after which Delhivery tends to message the customer. */
const TRIGGER_EVENTS: readonly TrackingEventType[] = [
  TrackingEventType.OUT_FOR_DELIVERY,
  TrackingEventType.DELIVERY_ATTEMPTED,
  TrackingEventType.DELIVERY_FAILED,
  TrackingEventType.ADDRESS_ISSUE,
  TrackingEventType.CUSTOMER_REFUSED,
  TrackingEventType.CUSTOMER_REQUESTED_RESCHEDULE,
];
const FINAL: readonly ShipmentStatus[] = [
  ShipmentStatus.DELIVERED,
  ShipmentStatus.RTO_DELIVERED,
  ShipmentStatus.CANCELLED,
  ShipmentStatus.LOST,
  ShipmentStatus.DAMAGED,
];

/** Sweep reads at most this many parcels per run: the panel is one shared browser. */
const SWEEP_BATCH = 5;

/**
 * Reads Delhivery One's "View Whatsapp" window and keeps a verbatim,
 * insert-only copy. Runs only in the portal worker, on the existing
 * portal queue (concurrency 1), and only when
 * `courier.delhivery_whatsapp_enabled` is on — checked per job.
 */
@Injectable()
export class DelhiveryWhatsappService {
  private readonly logger = new Logger(DelhiveryWhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly session: PortalSessionService,
  ) {}

  async enabled(): Promise<boolean> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: WHATSAPP_SETTING_KEY },
      select: { valueBoolean: true },
    });
    return row?.valueBoolean === true;
  }

  /** Read one parcel now (on-demand job, or one step of the sweep). */
  async fetchOne(shipmentId: string): Promise<WhatsappFetchOutcome> {
    if (!(await this.enabled())) return 'DISABLED';
    const ship = await this.prisma.client.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, courierCode: true, awbNumber: true, courierAccountId: true },
    });
    if (ship === null || ship.courierCode !== WHATSAPP_COURIER || ship.awbNumber === null) {
      return 'SKIPPED';
    }

    let outcome: WhatsappFetchOutcome;
    let stored = 0;
    let page: Awaited<ReturnType<PortalSessionService['page']>> | null = null;
    try {
      page = await this.session.page(ship.courierAccountId);
      const read = await new DelhiveryWhatsappPage(page).read(ship.awbNumber);
      outcome = this.outcomeOf(read);
      if (read.messages !== null) stored = await this.store(ship.id, read);
    } catch (err) {
      outcome = 'FAILED';
      this.logger.warn(
        { shipmentId, err: err instanceof Error ? err.message : String(err) },
        'Could not read the courier WhatsApp window',
      );
    } finally {
      await page?.close().catch(() => undefined);
    }

    const now = new Date();
    const count = await this.prisma.client.courierWhatsappMessage.count({
      where: { shipmentId: ship.id },
    });
    await this.prisma.client.courierWhatsappCheck.upsert({
      where: { shipmentId: ship.id },
      create: {
        shipmentId: ship.id,
        lastAttemptAt: now,
        lastOutcome: outcome,
        messageCount: count,
      },
      update: { lastAttemptAt: now, lastOutcome: outcome, messageCount: count },
    });
    this.logger.log({ shipmentId, outcome, stored }, 'Courier WhatsApp read');
    return outcome;
  }

  private outcomeOf(read: WhatsappRead): WhatsappFetchOutcome {
    if (!read.found) return 'UNREADABLE';
    if (!read.available) return 'NO_BUTTON';
    return read.messages === null ? 'UNREADABLE' : 'OK';
  }

  /** INSERT-ONLY: bubbles already stored are skipped by the unique hash. */
  private async store(shipmentId: string, read: WhatsappRead): Promise<number> {
    const bubbles = read.messages ?? [];
    const hashes = bubbleHashes(bubbles);
    const res = await this.prisma.client.courierWhatsappMessage.createMany({
      data: bubbles.map((b, i) => ({
        shipmentId,
        courierCode: WHATSAPP_COURIER,
        text: b.text,
        sentLabel: b.sentLabel,
        sentAt: parseSentAt(b.sentLabel),
        dedupeHash: hashes[i] as string,
      })),
      skipDuplicates: true,
    });
    return res.count;
  }

  /**
   * Parcels worth a look: a delivery-time scan seen, and either still
   * moving or finished less than seven days ago — and not read in the
   * last six hours.
   */
  async sweep(): Promise<{ picked: number; outcomes: Record<string, number> }> {
    const outcomes: Record<string, number> = {};
    if (!(await this.enabled())) return { picked: 0, outcomes };

    const now = Date.now();
    const rows = await this.prisma.client.shipment.findMany({
      where: {
        courierCode: WHATSAPP_COURIER,
        awbNumber: { not: null },
        trackingEvents: {
          some: {
            eventType: { in: [...TRIGGER_EVENTS] },
            eventAt: { gte: new Date(now - 45 * 24 * 60 * 60 * 1000) },
          },
        },
        OR: [
          { status: { notIn: [...FINAL] } },
          {
            status: { in: [...FINAL] },
            trackingEvents: {
              some: {
                status: { in: [...FINAL] },
                eventAt: { gte: new Date(now - WHATSAPP_TAIL_MS) },
              },
            },
          },
        ],
      },
      select: { id: true, courierWhatsappCheck: { select: { lastAttemptAt: true } } },
      take: 200,
    });
    const due = rows
      .filter(
        (r) =>
          r.courierWhatsappCheck === null ||
          now - r.courierWhatsappCheck.lastAttemptAt.getTime() >= WHATSAPP_DEBOUNCE_MS,
      )
      // Never read first, then the longest ago.
      .sort(
        (a, b) =>
          (a.courierWhatsappCheck?.lastAttemptAt.getTime() ?? 0) -
          (b.courierWhatsappCheck?.lastAttemptAt.getTime() ?? 0),
      )
      .slice(0, SWEEP_BATCH);

    for (const r of due) {
      const o = await this.fetchOne(r.id);
      outcomes[o] = (outcomes[o] ?? 0) + 1;
    }
    return { picked: due.length, outcomes };
  }
}
