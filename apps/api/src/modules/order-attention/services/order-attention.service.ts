import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { NotificationLedgerService } from '../../notifications/services/notification-ledger.service';
import { EnvService } from '../../../config/env.service';
import { NotificationChannel, NotificationRecipientType } from '@skydrop/db';

/** Where the parcels are. The cutoff is an hour of the DELIVERY day. */
const DELIVERY_TIMEZONE = 'Asia/Kolkata';

const SETTING_ENABLED = 'ops.nsa_enabled';
const SETTING_CUTOFF_HOUR = 'ops.nsa_cutoff_hour';
const SETTING_MAX_DAYS = 'ops.nsa_max_days';

export interface NsaOrderView {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly sellerId: string;
  readonly sellerName: string | null;
  readonly status: OrderStatus;
  readonly recipientName: string;
  readonly recipientCity: string;
  readonly recipientPhoneE164: string;
  readonly codAmountInr: string | null;
  readonly awbNumber: string | null;
  readonly courierCode: string | null;
  /** Which evening this is — 1 the first night, 2 and 3 after. */
  readonly dayCount: number;
  readonly raisedAt: Date;
  readonly outForDeliveryAt: Date | null;
  readonly acknowledgedAt: Date | null;
  readonly note: string | null;
}

export interface NsaSweepSummary {
  readonly ranAt: Date;
  readonly skippedBeforeCutoff: boolean;
  readonly examined: number;
  readonly raised: number;
  readonly escalated: number;
  readonly cleared: number;
}

/**
 * NSA — Needs Seller Attention.
 *
 * ── WHAT IT MEANS ────────────────────────────────────────────────────
 * A parcel went out for delivery and was STILL out for delivery when the
 * evening came. The van did not reach the customer, and — unlike an NDR
 * — the courier has not said why. Nobody finds out unless somebody asks,
 * and that is the whole point: the seller calls us or we call the
 * courier.
 *
 * ── WHY A FLAG AND NOT A STATUS ──────────────────────────────────────
 * The parcel is still genuinely out for delivery. `status` answers WHERE
 * IT IS and has to keep saying so, because a DELIVERED scan at 8pm needs
 * somewhere to go — the mapping only accepts DELIVERED from
 * OUT_FOR_DELIVERY. An NSA status would need an edge to every terminal
 * it could reach, on each of days 1, 2 and 3, and one missing edge
 * strands the order silently. That is not hypothetical: a missing
 * DELIVERY_FAILED → IN_TRANSIT edge did exactly this to a live parcel
 * for twelve hours in the same week this was written.
 *
 * So: status says where the parcel is, NSA says whether we need to act,
 * and the two cannot contradict each other.
 *
 * ── THE FLAG IS LIVE ONLY WHILE THE PARCEL IS ────────────────────────
 * Every read requires `nsa_cleared_at IS NULL` AND the order still being
 * OUT_FOR_DELIVERY. A parcel that gets delivered overnight stops being
 * flagged the moment its status moves, whether or not the sweep has run
 * since — a stale alarm on a delivered parcel is how people learn to
 * ignore the list.
 */
@Injectable()
export class OrderAttentionService {
  private readonly logger = new Logger(OrderAttentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly ledger: NotificationLedgerService,
    private readonly env: EnvService,
  ) {}

  /**
   * Which day of an order's out-for-delivery run a given moment falls
   * on, counted in CALENDAR DAYS at the delivery timezone.
   *
   * Calendar days, not elapsed hours: "still out at 6pm on the second
   * evening" is the question, and a parcel that went out at 11pm would
   * otherwise reach "day 2" seven hours later at 6am.
   *
   * Returns 0 before the first cutoff has passed.
   */
  static evenings(outForDeliveryAt: Date, now: Date, cutoffHour: number): number {
    const dayOf = (d: Date): string =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: DELIVERY_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
    const hourOf = (d: Date): number =>
      Number(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: DELIVERY_TIMEZONE,
          hour: '2-digit',
          hour12: false,
        }).format(d),
      );

    const start = Date.parse(`${dayOf(outForDeliveryAt)}T00:00:00Z`);
    const today = Date.parse(`${dayOf(now)}T00:00:00Z`);
    const wholeDays = Math.floor((today - start) / 86_400_000);
    if (wholeDays < 0) return 0;
    // Today only counts once its own cutoff has passed.
    return hourOf(now) >= cutoffHour ? wholeDays + 1 : wholeDays;
  }

  /**
   * Raise, escalate and tidy up. Idempotent per evening: running it
   * twice in one night changes nothing, because the day number it
   * computes is the same both times.
   */
  async sweep(now: Date = new Date()): Promise<NsaSweepSummary> {
    // Global keys, read straight from system_settings: none of them is
    // seller-overridable, and the resolver is the per-seller path
    // (SET-1). Each falls back to its seeded default rather than
    // refusing to run — a missing row must not stop the floor being told
    // about a stuck parcel.
    const [enabled, cutoffHour, maxDays] = await Promise.all([
      this.globalBool(SETTING_ENABLED, true),
      this.globalInt(SETTING_CUTOFF_HOUR, 18),
      this.globalInt(SETTING_MAX_DAYS, 3),
    ]);

    const summary = {
      ranAt: now,
      skippedBeforeCutoff: false,
      examined: 0,
      raised: 0,
      escalated: 0,
      cleared: 0,
    };
    if (!enabled) return summary;

    // Tidy first, and unconditionally: a parcel that moved on should
    // stop being flagged even on a night the raise half is skipped.
    summary.cleared = await this.clearMoved();

    const candidates = await this.prisma.client.order.findMany({
      where: { status: OrderStatus.OUT_FOR_DELIVERY, deletedAt: null },
      select: { id: true, sellerId: true, orderNumber: true, nsaDayCount: true },
    });
    summary.examined = candidates.length;

    for (const order of candidates) {
      try {
        const outAt = await this.outForDeliveryAt(order.id);
        if (outAt === null) continue;
        const evening = OrderAttentionService.evenings(outAt, now, cutoffHour);
        if (evening < 1) continue;
        // Escalation stops climbing at the cap, but the flag STAYS
        // raised — a parcel stuck five nights has not stopped needing
        // attention just because we ran out of numbers for it.
        const day = Math.min(evening, maxDays);
        if (day <= order.nsaDayCount) continue;

        const first = order.nsaDayCount === 0;
        // Guarded on the day count we read, so two sweeps racing at the
        // cutoff cannot both raise: the second updates nothing.
        const claimed = await this.prisma.client.order.updateMany({
          where: { id: order.id, nsaDayCount: order.nsaDayCount },
          data: {
            nsaDayCount: day,
            nsaClearedAt: null,
            ...(first ? { nsaRaisedAt: now } : {}),
          },
        });
        if (claimed.count === 0) continue;

        if (first) summary.raised += 1;
        else summary.escalated += 1;

        // Tell the seller, once per evening.
        //
        // Best-effort and AFTER the flag is durable: the flag is the
        // fact, the email is a reflection of it, and a mail server
        // having a bad minute must not mean nobody is told there is a
        // stuck parcel (NOTIF-1's discipline, applied outside M11's own
        // listener). The eventId carries the DAY, so re-running the
        // sweep the same evening dedups on NOTIF-2's composite key
        // while tomorrow's escalation is a genuinely new message.
        await this.notifySeller(order.id, day).catch((err: unknown) => {
          this.logger.warn(
            { err: err instanceof Error ? err.message : String(err), orderId: order.id },
            'NSA raised but the seller could not be told',
          );
        });

        await this.audit.log({
          actorType: 'SYSTEM',
          actorId: null,
          sellerId: order.sellerId,
          action: 'order.nsa_raised',
          entityType: 'order',
          entityId: order.id,
          severity: day >= maxDays ? 'HIGH' : 'MEDIUM',
          metadata: {
            orderNumber: order.orderNumber,
            dayCount: day,
            outForDeliveryAt: outAt.toISOString(),
          },
        });
      } catch (err) {
        // One order's problem must not stop the rest being flagged —
        // the same fan-out discipline as the manifest and AWB sagas.
        this.logger.error(
          { err: err instanceof Error ? err.message : String(err), orderId: order.id },
          'NSA sweep failed for one order; continuing',
        );
      }
    }

    this.logger.log({ ...summary, cutoffHour }, 'NSA sweep complete');
    return summary;
  }

  /**
   * Stamp `nsa_cleared_at` on anything flagged that is no longer out for
   * delivery. Bookkeeping rather than enforcement — the reads already
   * require the order to be OUT_FOR_DELIVERY, so a parcel that moves is
   * off the list immediately whether or not this has run.
   */
  private async clearMoved(): Promise<number> {
    const res = await this.prisma.client.order.updateMany({
      where: {
        nsaRaisedAt: { not: null },
        nsaClearedAt: null,
        status: { not: OrderStatus.OUT_FOR_DELIVERY },
      },
      data: { nsaClearedAt: new Date() },
    });
    return res.count;
  }

  /** How many nights, said the way a person would say it. */
  private static dayPhrase(day: number): string {
    if (day <= 1) return 'since yesterday';
    return `for ${day} days now`;
  }

  private async notifySeller(orderId: string, day: number): Promise<void> {
    const order = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      select: {
        orderNumber: true,
        sellerId: true,
        recipientName: true,
        recipientCity: true,
        seller: { select: { companyName: true, email: true } },
        orderShipments: {
          select: { shipment: { select: { awbNumber: true, courierCode: true } } },
          orderBy: { shipmentSequence: 'desc' },
          take: 1,
        },
      },
    });
    if (order === null) return;
    const ship = order.orderShipments[0]?.shipment ?? null;

    await this.ledger.enqueue({
      // The day is part of the key on purpose: two sweeps on one
      // evening are the same message and dedup, while the second
      // night's escalation is a different one and must get through.
      eventId: `nsa:${orderId}:${day}`,
      recipientType: NotificationRecipientType.SELLER,
      recipientId: order.sellerId,
      channel: NotificationChannel.EMAIL,
      templateCode: 'seller.order_needs_attention.email',
      locale: 'en',
      toEmail: order.seller?.email ?? null,
      orderId,
      triggerEvent: `order.nsa_raised.day_${day}`,
      variables: {
        company_name: order.seller?.companyName ?? '',
        order_number: order.orderNumber,
        recipient_name: order.recipientName,
        recipient_city: order.recipientCity,
        awb_number: ship?.awbNumber ?? '—',
        courier_name: ship?.courierCode ?? '—',
        nsa_day_phrase: OrderAttentionService.dayPhrase(day),
        app_url: this.env.sellerAppUrl,
      },
    });
  }

  private async globalInt(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueInt: true },
    });
    return row?.valueInt ?? fallback;
  }

  private async globalBool(key: string, fallback: boolean): Promise<boolean> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueBoolean: true },
    });
    return row?.valueBoolean ?? fallback;
  }

  /** When this order most recently went out for delivery. */
  private async outForDeliveryAt(orderId: string): Promise<Date | null> {
    const ev = await this.prisma.client.orderEvent.findFirst({
      where: { orderId, toStatus: OrderStatus.OUT_FOR_DELIVERY },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return ev?.createdAt ?? null;
  }

  /** The open worklist. `sellerId` scopes it to one seller's own. */
  async list(sellerId?: string): Promise<readonly NsaOrderView[]> {
    const rows = await this.prisma.client.order.findMany({
      where: {
        ...(sellerId === undefined ? {} : { sellerId }),
        deletedAt: null,
        // Live-only, both halves. See the class comment.
        status: OrderStatus.OUT_FOR_DELIVERY,
        nsaRaisedAt: { not: null },
        nsaClearedAt: null,
      },
      orderBy: [{ nsaDayCount: 'desc' }, { nsaRaisedAt: 'asc' }],
      select: {
        id: true,
        orderNumber: true,
        sellerId: true,
        status: true,
        recipientName: true,
        recipientCity: true,
        recipientPhoneE164: true,
        codAmountInr: true,
        nsaDayCount: true,
        nsaRaisedAt: true,
        nsaAcknowledgedAt: true,
        nsaNote: true,
        seller: { select: { companyName: true } },
        orderShipments: {
          select: { shipment: { select: { awbNumber: true, courierCode: true } } },
          orderBy: { shipmentSequence: 'desc' },
          take: 1,
        },
      },
    });

    const out: NsaOrderView[] = [];
    for (const r of rows) {
      const ship = r.orderShipments[0]?.shipment ?? null;
      out.push({
        orderId: r.id,
        orderNumber: r.orderNumber,
        sellerId: r.sellerId,
        sellerName: r.seller?.companyName ?? null,
        status: r.status,
        recipientName: r.recipientName,
        recipientCity: r.recipientCity,
        recipientPhoneE164: r.recipientPhoneE164,
        codAmountInr: r.codAmountInr === null ? null : r.codAmountInr.toFixed(2),
        awbNumber: ship?.awbNumber ?? null,
        courierCode: ship?.courierCode ?? null,
        dayCount: r.nsaDayCount,
        // Non-null by the query's own filter.
        raisedAt: r.nsaRaisedAt ?? new Date(0),
        outForDeliveryAt: await this.outForDeliveryAt(r.id),
        acknowledgedAt: r.nsaAcknowledgedAt,
        note: r.nsaNote,
      });
    }
    return out;
  }

  /**
   * Somebody is on it.
   *
   * Recorded so two people do not ring the same courier about the same
   * parcel, which is the failure a shared worklist invites. It does NOT
   * clear the flag: the parcel is still stuck, and the only thing that
   * un-sticks it is the parcel moving.
   */
  async acknowledge(
    orderId: string,
    staffId: string,
    note: string | null,
  ): Promise<{ orderId: string; acknowledgedAt: Date }> {
    const now = new Date();
    const claimed = await this.prisma.client.order.updateMany({
      where: { id: orderId, nsaRaisedAt: { not: null }, nsaClearedAt: null },
      data: {
        nsaAcknowledgedAt: now,
        nsaAcknowledgedByStaffId: staffId,
        ...(note === null ? {} : { nsaNote: note }),
      },
    });
    if (claimed.count === 0) {
      throw new NotFoundException({
        code: 'NSA_NOT_RAISED',
        message: 'This order has no open NSA flag — it may have moved on already',
      });
    }
    await this.audit.log({
      actorType: 'STAFF',
      actorId: staffId,
      action: 'order.nsa_acknowledged',
      entityType: 'order',
      entityId: orderId,
      severity: 'LOW',
      metadata: { note },
    });
    return { orderId, acknowledgedAt: now };
  }
}
