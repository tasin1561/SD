import { Injectable, Logger } from '@nestjs/common';
import {
  LOW_MEMORY_DELAY_MS,
  RECYCLE_AFTER_READS,
  READ_TIMEOUT_MS,
  availableMemoryMb,
  memoryOk,
} from '../../courier-whatsapp/guards';
import {
  LOWMEM_KEY,
  WhatsappBreakerStore,
} from '../../courier-whatsapp/services/whatsapp-breaker.store';
import type { BreakerReason } from '../../courier-whatsapp/breaker';
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
  WHATSAPP_OFD_EVENTS,
  WHATSAPP_PARALLEL_KEY,
  WHATSAPP_PARALLEL_MAX,
  WHATSAPP_SETTING_KEY,
  WHATSAPP_TAIL_MS,
  type WhatsappReadKind,
} from '../../courier-whatsapp/whatsapp.constants';
import {
  DelhiveryWhatsappPage,
  WhatsappBlockedError,
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
  | 'LOGGED_OUT'
  | 'BLOCKED'
  | 'BREAKER_OPEN'
  | 'LOW_MEMORY';

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
  private inFlight = 0;
  private readsSinceRecycle = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly session: PortalSessionService,
    private readonly channel: CourierChannelSettingsService,
    private readonly requests: CourierWhatsappRequestService,
    private readonly breaker: WhatsappBreakerStore,
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

  async hourlyCap(): Promise<number> {
    return this.int(WHATSAPP_HOURLY_CAP_KEY, 400);
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

  /**
   * Read one parcel now. Never throws: every failure is an outcome, so a
   * bad read cannot take the worker down. `retryAfterMs` asks the worker
   * to try the SAME parcel again later (breaker open, memory short).
   */
  async fetchOne(
    shipmentId: string,
    kind: WhatsappReadKind = 'viewer',
  ): Promise<{
    outcome: WhatsappFetchOutcome;
    nextDelayMs: number | null;
    retryAfterMs: number | null;
  }> {
    const none = (
      outcome: WhatsappFetchOutcome,
      retryAfterMs: number | null = null,
    ): { outcome: WhatsappFetchOutcome; nextDelayMs: null; retryAfterMs: number | null } => ({
      outcome,
      nextDelayMs: null,
      retryAfterMs,
    });
    if (!(await this.mayRun())) return none('DISABLED');
    const g = await this.breaker.gate();
    if (g === 'wait') {
      const st = await this.breaker.state();
      return none('BREAKER_OPEN', Math.max(30_000, (st.openUntil ?? Date.now()) - Date.now()));
    }
    if (kind === 'sweep') {
      const cap = await this.int(WHATSAPP_HOURLY_CAP_KEY, 400);
      const lastHour = await this.prisma.client.courierWhatsappRead.count({
        where: { at: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      });
      // Hot / event / viewer reads are never held back by the ceiling.
      if (lastHour >= cap) return none('CAPPED');
    }
    // Memory guard: no new tab on a squeezed droplet. The probe slot is
    // given back by NOT having touched the breaker yet.
    if (!memoryOk(availableMemoryMb())) {
      await this.breaker.bump(LOWMEM_KEY).catch(() => undefined);
      return none('LOW_MEMORY', LOW_MEMORY_DELAY_MS);
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
    // A box, because the response listener assigns it from a callback.
    const box: { trip: { reason: BreakerReason; hard: boolean } | null } = { trip: null };
    let page: Awaited<ReturnType<PortalSessionService['page']>> | null = null;
    this.inFlight += 1;
    try {
      page = await this.tab(ship.courierAccountId);
      // HTTP 429 anywhere, or a 5xx on the page itself, opens the breaker.
      try {
        page.on('response', (r) => {
          const status = r.status();
          if (!/one\.delhivery\.com/.test(r.url())) return;
          if (status === 429) box.trip = { reason: 'RATE_LIMITED', hard: true };
          else if (status >= 500 && r.request().resourceType() === 'document') {
            box.trip = { reason: 'SERVER_ERROR', hard: true };
          }
        });
      } catch {
        // a page object without events (tests)
      }
      const live = page;
      const read = await Promise.race([
        new DelhiveryWhatsappPage(live).read(ship.awbNumber),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('read timed out')), READ_TIMEOUT_MS).unref?.(),
        ),
      ]);
      outcome = this.outcomeOf(read);
      if (read.messages !== null) stored = await this.store(ship.id, read);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof WhatsappLoggedOutError) {
        outcome = 'LOGGED_OUT';
        box.trip = { reason: 'LOGGED_OUT', hard: true };
        // The next probe signs in ONCE, after the pause.
        this.warmed.delete(ship.courierAccountId ?? '');
      } else if (err instanceof WhatsappBlockedError) {
        outcome = 'BLOCKED';
        box.trip = { reason: 'CAPTCHA', hard: true };
      } else {
        outcome = 'FAILED';
        box.trip ??= { reason: 'FAILURES', hard: false };
        if (/closed|crash|disconnected/i.test(message)) {
          await this.session.recycleContext(ship.courierAccountId).catch(() => undefined);
          this.warmed.delete(ship.courierAccountId ?? '');
        }
        this.logger.warn(
          { shipmentId, err: message },
          'Could not read the courier WhatsApp window',
        );
      }
    } finally {
      this.inFlight -= 1;
      await page?.close().catch(() => undefined);
    }
    await this.afterRead(outcome, box.trip, ship.courierAccountId);

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
      retryAfterMs: null,
    };
  }

  /** Feed the breaker, and recycle the browser context every 200 reads. */
  private async afterRead(
    outcome: WhatsappFetchOutcome,
    trip: { reason: BreakerReason; hard: boolean } | null,
    accountId: string | null,
  ): Promise<void> {
    if (trip !== null) {
      const next = await this.breaker.failure(trip.reason, trip.hard).catch(() => null);
      if (next?.status === 'open') {
        this.logger.warn(
          { reason: next.reason, until: next.openUntil },
          'WhatsApp reader breaker OPEN',
        );
      }
    } else if (outcome === 'OK' || outcome === 'NO_BUTTON') {
      await this.breaker.success().catch(() => undefined);
    }
    this.readsSinceRecycle += 1;
    if (this.readsSinceRecycle >= RECYCLE_AFTER_READS && this.inFlight === 0) {
      this.readsSinceRecycle = 0;
      await this.session.recycleContext(accountId).catch(() => undefined);
      this.warmed.delete(accountId ?? '');
    }
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
