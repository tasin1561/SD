import { Injectable, Logger } from '@nestjs/common';
import { CourierPortalMode, ShipmentStatus, TrackingEventType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CourierChannelSettingsService } from '../../courier-escalation/services/courier-channel-settings.service';
import { nextCadence } from '../../courier-whatsapp/cadence';
import { CourierWhatsappRequestService } from '../../courier-whatsapp/services/courier-whatsapp-request.service';
import {
  WHATSAPP_BATCH_KEY,
  WHATSAPP_COURIER,
  WHATSAPP_FAILED_EVENTS,
  WHATSAPP_HOURLY_CAP_KEY,
  WHATSAPP_LOGGED_OUT_PAUSE_MS,
  WHATSAPP_OFD_EVENTS,
  WHATSAPP_PARALLEL_KEY,
  WHATSAPP_PARALLEL_MAX,
  WHATSAPP_SETTING_KEY,
  WHATSAPP_TAIL_MS,
  type WhatsappReadKind,
} from '../../courier-whatsapp/whatsapp.constants';
import {
  DelhiveryWhatsappPage,
  WhatsappLoggedOutError,
  bubbleHashes,
  parseSentAt,
  type WhatsappRead,
} from '../pages/delhivery-whatsapp.page';
import { PortalSessionService } from './portal-session.service';

export type WhatsappFetchOutcome =
  | 'DISABLED'
  | 'SKIPPED'
  | 'PAUSED'
  | 'CAPPED'
  | 'OK'
  | 'NO_BUTTON'
  | 'UNREADABLE'
  | 'FAILED'
  | 'LOGGED_OUT';

const TRIGGER_EVENTS: readonly TrackingEventType[] = [
  ...WHATSAPP_OFD_EVENTS,
  ...WHATSAPP_FAILED_EVENTS,
].map((t) => TrackingEventType[t]);
const FINAL: readonly ShipmentStatus[] = [
  ShipmentStatus.DELIVERED,
  ShipmentStatus.RTO_DELIVERED,
  ShipmentStatus.CANCELLED,
  ShipmentStatus.LOST,
  ShipmentStatus.DAMAGED,
];

/**
 * Reads Delhivery One's "View Whatsapp" window and keeps a verbatim,
 * insert-only copy. Runs only in the portal worker process, on its own
 * queue; every read is a fresh tab of the ONE signed-in browser context.
 *
 * Sign-in discipline: the first read of an account signs in once
 * (single-flight). After that, tabs never sign in — if one lands on the
 * login page the whole reader pauses for ten minutes and records it.
 */
@Injectable()
export class DelhiveryWhatsappService {
  private readonly logger = new Logger(DelhiveryWhatsappService.name);
  private readonly warmed = new Set<string>();
  private warming = new Map<string, Promise<void>>();
  private pausedUntil = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly session: PortalSessionService,
    private readonly channel: CourierChannelSettingsService,
    private readonly requests: CourierWhatsappRequestService,
  ) {}

  async enabled(): Promise<boolean> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: WHATSAPP_SETTING_KEY },
      select: { valueBoolean: true },
    });
    return row?.valueBoolean === true;
  }

  private async int(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueInt: true },
    });
    return row?.valueInt ?? fallback;
  }

  /** 1..3, from the setting. */
  async parallel(): Promise<number> {
    const n = await this.int(WHATSAPP_PARALLEL_KEY, 2);
    return Math.min(WHATSAPP_PARALLEL_MAX, Math.max(1, n));
  }

  /** The master switch AND the portal kill switch (CUR-18): OFF opens nothing. */
  async mayRun(): Promise<boolean> {
    if (!(await this.enabled())) return false;
    return (await this.channel.get()).portalMode !== CourierPortalMode.OFF;
  }

  private async tab(
    accountId: string | null,
  ): Promise<Awaited<ReturnType<PortalSessionService['page']>>> {
    const key = accountId ?? '';
    if (!this.warmed.has(key)) {
      let p = this.warming.get(key);
      if (p === undefined) {
        p = (async () => {
          const page = await this.session.page(accountId);
          await page.close().catch(() => undefined);
          this.warmed.add(key);
        })().finally(() => this.warming.delete(key));
        this.warming.set(key, p);
      }
      await p;
    }
    return this.session.readerPage(accountId);
  }

  /** Read one parcel now. Returns the outcome and, when hot, the delay to the next read. */
  async fetchOne(
    shipmentId: string,
    kind: WhatsappReadKind = 'viewer',
  ): Promise<{ outcome: WhatsappFetchOutcome; nextDelayMs: number | null }> {
    const none = (
      outcome: WhatsappFetchOutcome,
    ): { outcome: WhatsappFetchOutcome; nextDelayMs: null } => ({
      outcome,
      nextDelayMs: null,
    });
    if (!(await this.mayRun())) return none('DISABLED');
    if (Date.now() < this.pausedUntil) return none('PAUSED');
    if (kind === 'sweep') {
      const cap = await this.int(WHATSAPP_HOURLY_CAP_KEY, 400);
      const lastHour = await this.prisma.client.courierWhatsappRead.count({
        where: { at: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      });
      // Hot / event / viewer reads are never held back by the ceiling.
      if (lastHour >= cap) return none('CAPPED');
    }
    const ship = await this.prisma.client.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        courierCode: true,
        awbNumber: true,
        courierAccountId: true,
        courierWhatsappCheck: { select: { gapMs: true, lastNewAt: true } },
      },
    });
    if (ship === null || ship.courierCode !== WHATSAPP_COURIER || ship.awbNumber === null) {
      return none('SKIPPED');
    }

    let outcome: WhatsappFetchOutcome;
    let stored = 0;
    let page: Awaited<ReturnType<PortalSessionService['page']>> | null = null;
    try {
      page = await this.tab(ship.courierAccountId);
      const read = await new DelhiveryWhatsappPage(page).read(ship.awbNumber);
      outcome = this.outcomeOf(read);
      if (read.messages !== null) stored = await this.store(ship.id, read);
    } catch (err) {
      if (err instanceof WhatsappLoggedOutError) {
        outcome = 'LOGGED_OUT';
        // Stop the batch, remember it, and let the next try sign in once.
        this.pausedUntil = Date.now() + WHATSAPP_LOGGED_OUT_PAUSE_MS;
        this.warmed.delete(ship.courierAccountId ?? '');
        this.logger.warn({ shipmentId }, 'Delhivery asked for a sign-in; WhatsApp reads paused');
      } else {
        outcome = 'FAILED';
        this.logger.warn(
          { shipmentId, err: err instanceof Error ? err.message : String(err) },
          'Could not read the courier WhatsApp window',
        );
      }
    } finally {
      await page?.close().catch(() => undefined);
    }

    const now = new Date();
    // A read that did not reach the window says nothing about news: keep
    // the previous cadence rather than drifting it.
    const reached = outcome === 'OK' || outcome === 'NO_BUTTON';
    const prev = {
      gapMs: ship.courierWhatsappCheck?.gapMs ?? null,
      lastNewAt: ship.courierWhatsappCheck?.lastNewAt ?? null,
    };
    const cad = nextCadence({ now, prev, foundNew: stored > 0 });
    const count = await this.prisma.client.courierWhatsappMessage.count({
      where: { shipmentId: ship.id },
    });
    const state = reached
      ? { nextReadAt: cad.nextReadAt, gapMs: cad.gapMs, lastNewAt: cad.lastNewAt }
      : {
          nextReadAt: new Date(now.getTime() + 30 * 60_000),
          gapMs: prev.gapMs,
          lastNewAt: prev.lastNewAt,
        };
    await this.prisma.client.courierWhatsappCheck.upsert({
      where: { shipmentId: ship.id },
      create: {
        shipmentId: ship.id,
        lastAttemptAt: now,
        lastOutcome: outcome,
        messageCount: count,
        ...state,
      },
      update: { lastAttemptAt: now, lastOutcome: outcome, messageCount: count, ...state },
    });
    await this.prisma.client.courierWhatsappRead.create({
      data: { shipmentId: ship.id, outcome, newCount: stored, kind },
    });
    this.logger.log({ shipmentId, outcome, stored, kind }, 'Courier WhatsApp read');
    return {
      outcome,
      nextDelayMs: reached && cad.hot ? cad.nextReadAt.getTime() - now.getTime() : null,
    };
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
   * The safety net, every 15 minutes: queue up to `batch` due parcels
   * (a delivery-time scan seen; still moving or finished under 7 days
   * ago; `nextReadAt` due). The event-driven reads do the real work.
   */
  async sweep(): Promise<{ queued: number }> {
    if (!(await this.mayRun())) return { queued: 0 };
    const batch = Math.max(0, await this.int(WHATSAPP_BATCH_KEY, 60));
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
      select: {
        id: true,
        courierWhatsappCheck: { select: { nextReadAt: true, lastAttemptAt: true } },
      },
      take: 400,
    });
    const dueAt = (r: (typeof rows)[number]): number =>
      r.courierWhatsappCheck === null
        ? 0
        : (
            r.courierWhatsappCheck.nextReadAt ??
            new Date(r.courierWhatsappCheck.lastAttemptAt.getTime() + 6 * 3600_000)
          ).getTime();
    const due = rows
      .filter((r) => dueAt(r) <= now)
      .sort((a, b) => dueAt(a) - dueAt(b))
      .slice(0, batch);
    let queued = 0;
    for (const r of due) {
      const out = await this.requests.request(r.id, { kind: 'sweep', ignoreFloor: true });
      if (out.queued) queued += 1;
    }
    return { queued };
  }
}
