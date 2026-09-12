import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  DeliveryActionKind,
  DeliveryActionStatus,
  OrderStatus,
  ShipmentStatus,
  SystemIssueKind,
  SystemIssueSeverity,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { NotificationLedgerService } from '../../notifications/services/notification-ledger.service';
import { EnvService } from '../../../config/env.service';
import { NotificationChannel, NotificationRecipientType } from '@skydrop/db';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { TrackingStatusMappingService } from '../../tracking-events/services/tracking-status-mapping.service';
import { OrderReadService } from '../../order/services/order-read.service';
import { AwbGenerationJobService } from '../../courier-awb/services/awb-generation-job.service';
import { TrackingEventAppendService } from '../../tracking-events/services/tracking-event-append.service';
import { AwbLabelRecoveryService } from '../../courier-awb/services/awb-label-recovery.service';

/** Where the parcels are. The cutoff is an hour of the DELIVERY day. */
const DELIVERY_TIMEZONE = 'Asia/Kolkata';

/**
 * Any state that means the return is genuinely under way. RTO_RECEIVED
 * and beyond are included deliberately: a parcel can be back on the
 * bench before the scan that says it is travelling ever lands, and
 * alarming about a return that has already arrived is worse than
 * useless.
 */
/** Every pre-dispatch status where a parcel exists and is expected to
 *  carry a waybill. Pick and pack do not check for one, so an order can
 *  travel all the way to PACKED unbooked; the sweep has to look at the
 *  whole stretch rather than only where the booking was first attempted. */
/**
 * How many refusals before we stop asking the courier and just say so.
 *
 * Each retry that fails supersedes the shipment, so an uncapped loop is
 * a live courier call every few hours, forever, on a parcel whose
 * answer is not going to change (CUR-13: a refusal is an opinion about
 * the parcel, not a wobble). Three is enough evidence.
 */
const MAX_AWB_RETRY_SUPERSEDES = 3;

const AWB_EXPECTED_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.CONFIRMED,
  OrderStatus.PENDING_PICK,
  OrderStatus.PICKED,
  OrderStatus.PACKED,
  OrderStatus.PENDING_DISPATCH,
]);

const RTO_UNDERWAY: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.RTO_INITIATED,
  OrderStatus.RTO_IN_TRANSIT,
  OrderStatus.RTO_RECEIVED,
  OrderStatus.RTO_RESTOCKED,
  OrderStatus.RTO_DAMAGED,
  // Terminal ends where a return is no longer the question.
  OrderStatus.DELIVERED,
  OrderStatus.LOST_IN_TRANSIT,
  OrderStatus.CANCELLED_BY_ADMIN,
]);

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
  /** Returns the seller asked for that the courier has not started. */
  readonly stalledReturns: number;
  /** Confirmed orders still carrying no waybill after the grace window. */
  readonly awbless: number;
  /** Parcels whose courier scans cannot move the order — the model has
   *  no route from where the order is to where the courier says it is. */
  readonly strandedTracking: number;
  /** Returns the courier handed back that nobody has received. */
  readonly unreceivedReturns: number;
  /** Voided shipments of cancelled orders whose waybill is still live
   *  with the courier past the grace window. */
  readonly liveWaybills: number;
  /** Pre-dispatch waybills still without a stored label after an hour,
   *  having been asked for again on this run. */
  readonly labelless: number;
}

/** One issue per voided shipment; the suffix is the shipment id. */
const LIVE_WAYBILL_KEY_PREFIX = 'live-waybill:';

/** One issue per shipment whose waybill has no stored label. */
const LABEL_MISSING_KEY_PREFIX = 'awb-label-missing:';
/** The AWB job retries its own label leg for ~20s; ten minutes is well
 *  clear of that, so the sweep never races a job still in flight. */
const LABEL_RETRY_AFTER_MS = 10 * 60_000;
/** Raised only once the label has been missing this long — a courier
 *  whose download link lags a minute is not an incident. */
const LABEL_ALERT_AFTER_MS = 60 * 60_000;
/** Per run; the sweep is hourly and a backlog drains over a few runs. */
const LABEL_SWEEP_LIMIT = 50;

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
    private readonly issues: SystemIssueService,
    private readonly awbJob: AwbGenerationJobService,
    private readonly mapping: TrackingStatusMappingService,
    private readonly orders: OrderReadService,
    // The courier's own scan times (TRK-3) — see reachedStatusAt for why
    // `shipments.updatedAt` cannot answer "how long has this waited".
    private readonly trackingEvents: TrackingEventAppendService,
    // CUR-6 — asks again for a label the AWB job gave up on.
    private readonly labels: AwbLabelRecoveryService,
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
      stalledReturns: 0,
      awbless: 0,
      strandedTracking: 0,
      unreceivedReturns: 0,
      liveWaybills: 0,
      labelless: 0,
    };

    // Runs even when the NSA half is switched off, and before the
    // enabled check: this is not an NSA flag, it is a courier that
    // accepted a cancellation and then did nothing. Gating it behind an
    // unrelated switch is how it would come to be silently off.
    summary.stalledReturns = await this.checkStalledReturns(now);

    // Also unconditional, and for the same reason: an order that has no
    // waybill is not moving, whatever the NSA switch says.
    summary.awbless = await this.checkAwblessConfirmed(now);

    // Also unconditional: a parcel whose scans cannot move its order is
    // silently misreporting to a seller, whatever the NSA switch says.
    summary.strandedTracking = await this.checkStrandedTracking(now);

    // Also unconditional: a return sitting at our own door, unreceived,
    // is a seller being told their goods are still travelling.
    summary.unreceivedReturns = await this.checkUnreceivedReturns(now);

    // Also unconditional: a cancelled order's waybill left live with the
    // courier is a booking charge not credited back, whatever NSA says.
    summary.liveWaybills = await this.checkLiveWaybills(now);

    // Also unconditional: a parcel with a waybill and no label cannot be
    // scanned at the pack bench, whatever the NSA switch says.
    summary.labelless = await this.checkLabellessAwbs(now);

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
  /**
   * A return the seller asked for that never started.
   *
   * The seller clicks "send it back", Delhivery accepts the
   * cancellation, and then — sometimes — nothing. No RTO scan, and the
   * order sits in OUT_FOR_DELIVERY while the seller believes their
   * goods are on the way back. Nothing else in the system notices:
   * the request row says EXECUTED because the courier really did accept
   * it, and every downstream step is waiting on a scan that is not
   * coming.
   *
   * So this is the one check that the RTO chain cannot make for itself,
   * and it is why "we told the courier" is not the same fact as "the
   * parcel is coming back".
   *
   * Clears itself once the order reaches any RTO state — including
   * RTO_RECEIVED, for a parcel that came back faster than a scan did.
   */
  /**
   * A confirmed order that still has no waybill.
   *
   * The AWB is generated at confirmation (CUR-2b) by a listener on the
   * lifecycle bus, which fires ONCE, on ENTRY to CONFIRMED. If that
   * attempt and its BullMQ retries all fail, nothing ever asks again:
   * the order is already CONFIRMED so the listener will not re-fire, and
   * the manifest-close job only reaches parcels that got picked and
   * packed — which this one cannot be, because a picker works from a
   * queue it is in, and it is, but nobody is watching whether it moves.
   *
   * SD-2026-26-000003 sat exactly there for a day: reserved stock, a
   * shipment, no waybill, no error anywhere a person looks. The order
   * had not failed. It had simply stopped, quietly, and the only symptom
   * was its absence from a list.
   *
   * So this does two things, in this order:
   *
   *   1. ASKS AGAIN. `processOrder` is idempotent and gated on
   *      `awbNumber` (CUR-9), so a retry never doubles a real booking or
   *      a real charge. If the original failure was transient this just
   *      fixes it. If the courier refuses, the refusal now routes the
   *      order to manual placement (CUR-13/CUR-14) — which is the whole
   *      point: the retry is what DELIVERS that routing to an order that
   *      was already past the moment it would otherwise have happened.
   *
   *   2. RAISES an issue if it is still stuck afterwards. That is the
   *      case where asking again is not the answer and a person is
   *      needed — and it is now a card on /system-issues rather than a
   *      row nobody queries.
   *
   * Clears itself once the order has a waybill or has moved on.
   */
  private async checkAwblessConfirmed(now: Date): Promise<number> {
    const hours = await this.globalInt('ops.awb_stall_alert_hours', 6);
    const cutoff = new Date(now.getTime() - hours * 3_600_000);

    // The LIVE shipment only: a superseded one carries `supersededAt`
    // and has a CREATED successor (CUR-7), so filtering on status alone
    // would keep re-flagging a parcel that was already retired.
    //
    // Every pre-dispatch status, not just CONFIRMED (2026-09-03). Pick
    // and pack do not check for a waybill, so an order whose
    // confirmation-time booking failed can be picked and packed anyway
    // and end up boxed with nothing to scan at the handover bench. That
    // used to be caught by manifest close re-running the AWB job; now
    // that the bench dispatches directly, a manifest may never be
    // closed, and this sweep is the only thing left asking.
    const links = await this.prisma.client.orderShipment.findMany({
      where: {
        order: { status: { in: [...AWB_EXPECTED_STATUSES] }, deletedAt: null },
        shipment: {
          status: ShipmentStatus.CREATED,
          awbNumber: null,
          supersededAt: null,
          deletedAt: null,
          createdAt: { lt: cutoff },
        },
      },
      select: {
        orderId: true,
        shipmentId: true,
        order: { select: { orderNumber: true, sellerId: true } },
      },
    });
    if (links.length === 0) return 0;

    let stuck = 0;
    for (const link of links) {
      const key = `awb-stalled:${link.orderId}`;

      // 1. Ask again — but not forever.
      //
      // A courier that has REFUSED a parcel several times has formed an
      // opinion, and it will be the same opinion next time (CUR-13).
      // Asking again is then a real write against a live account for
      // nothing, and it supersedes the shipment each time, so the
      // retries also hide themselves: see the settled check below.
      // SD-2026-26-000001 was doing exactly this on a seven-hour cycle
      // — refused, superseded, clock reset, refused again — with no
      // issue ever raised and nobody aware of it.
      const priorAttempts = await this.prisma.client.orderShipment.count({
        where: { orderId: link.orderId, shipment: { supersededAt: { not: null } } },
      });
      const exhausted = priorAttempts >= MAX_AWB_RETRY_SUPERSEDES;
      if (!exhausted) {
        // Per-order isolation: one courier throwing must not stop the
        // others being retried, the same fan-out discipline as the AWB
        // job's own loop (CUR-2).
        try {
          await this.awbJob.processOrder(link.orderId);
        } catch (err) {
          this.logger.warn(
            { orderId: link.orderId, err: (err as Error).message },
            'AWB retry for a stalled order threw — falling through to the issue',
          );
        }
      }

      // 2. Did that settle it? Re-read rather than trusting the result:
      //    a refusal routes the ORDER (to PENDING_MANUAL_PLACEMENT) and
      //    supersedes the SHIPMENT, so the answer lives in the rows, not
      //    in the return value.
      const after = await this.prisma.client.order.findUnique({
        where: { id: link.orderId },
        select: { status: true },
      });
      // Ask about the order's CURRENT live shipment, not the one this
      // loop started with.
      //
      // `supersededAt !== null` used to count as settled here, on the
      // reasoning that a refusal routes the order away and retires the
      // shipment. That holds when the routing happens. When it does not
      // — a refusal on an order already past CONFIRMED — the supersede
      // is not a resolution at all: it is the identical problem wearing
      // a new row, and treating it as success meant every retry CLOSED
      // the issue it should have raised. An order refused four times
      // over two days therefore never appeared anywhere.
      const live = await this.prisma.client.orderShipment.findFirst({
        where: { orderId: link.orderId, shipment: { supersededAt: null, deletedAt: null } },
        orderBy: { shipmentSequence: 'desc' },
        select: { shipment: { select: { awbNumber: true } } },
      });
      const settled =
        after === null ||
        !AWB_EXPECTED_STATUSES.has(after.status) ||
        live === null ||
        live.shipment.awbNumber !== null;

      if (settled) {
        await this.issues.resolveByKey(
          key,
          `Sorted — the order is now ${(after?.status ?? 'gone').toString().toLowerCase().replaceAll('_', ' ')}.`,
        );
        continue;
      }

      stuck += 1;
      await this.issues.raise({
        kind: SystemIssueKind.INTEGRATION,
        severity: SystemIssueSeverity.HIGH,
        title: exhausted
          ? `${link.order.orderNumber}: the courier has refused this parcel ${priorAttempts} times`
          : `${link.order.orderNumber}: no waybill ${hours}h after its parcel was created`,
        detail: exhausted
          ? `The courier has been asked ${priorAttempts} times and refused every time, so we have ` +
            'stopped asking: a refusal is an opinion about this parcel and it will be the same ' +
            'opinion tomorrow. Nothing else will move this order.\n\n' +
            'Open it, read the last AWB error on the shipment, and either fix what the courier ' +
            'objected to or place it with another courier by hand. Until then the seller ' +
            'believes it is on its way.'
          : 'This order was confirmed and its stock reserved, but no courier has issued a ' +
            'waybill for it and a retry just now did not get one either. Nothing downstream ' +
            'will move it, and if it has already been picked and packed it will sit at the ' +
            'handover bench with no label to scan — the confirmation-time attempt does not ' +
            'repeat on its own.\n\n' +
            'The seller believes this order is on its way. Open the order, read the last AWB ' +
            'error on the shipment, and either fix what the courier objected to or place it ' +
            'manually.',
        source: 'OrderAttentionService',
        dedupeKey: key,
        metadata: {
          orderId: link.orderId,
          orderNumber: link.order.orderNumber,
          shipmentId: link.shipmentId,
          sellerId: link.order.sellerId,
          refusals: priorAttempts,
          retriesExhausted: exhausted,
        },
      });
    }
    return stuck;
  }

  /**
   * The courier is telling us something the order model cannot express.
   *
   * ── WHAT THIS CATCHES ────────────────────────────────────────────────
   * The tracking processor advances the SHIPMENT from a scan and then
   * asks the order to follow. When the order's current status is not in
   * the mapping's `allowedFromOrderStatuses`, the monotonic-forward
   * guard (TRK-4) skips the transition — correctly, most of the time: a
   * stale scan arriving after DELIVERED, or two scans landing out of
   * order, must not drag an order backwards.
   *
   * But the SAME skip, on the SAME parcel, over and over, is not a
   * stale scan. It is a hole in the model, and it is invisible: the
   * skip is logged at debug, the webhook is marked PROCESSED, and the
   * timeline fills in correctly while the order status quietly lies to
   * the seller.
   *
   * SD-TEST-523902 and SD-TEST-524086 sat in DELIVERY_FAILED for two
   * days while twenty-four RTO_IN_TRANSIT scans arrived and were
   * dropped, because RTO_IN_TRANSIT was reachable only from
   * RTO_INITIATED and Delhivery had not sent that scan. Both sellers
   * were told delivery had failed while their goods were most of the
   * way home. Nothing anywhere said so; it was found by a person
   * noticing an order looked wrong.
   *
   * ── HOW A REAL GAP IS TOLD FROM A STALE SCAN ─────────────────────────
   * By asking whether the order has EVER been where the scan says it
   * is. A stale scan names somewhere the order has already been —
   * `order_events` proves it, and the skip is correct. A gap names
   * somewhere the order has never reached and now cannot: the scan is
   * ahead, not behind, and no amount of waiting fixes it.
   *
   * NO RETRY, deliberately, unlike the AWB sweep: asking again cannot
   * help when the refusal is the matrix saying there is no such edge.
   * The fix is a code change, so the useful act is to say so — loudly,
   * once, with the parcel named.
   */
  private async checkStrandedTracking(now: Date): Promise<number> {
    const hours = await this.globalInt('ops.tracking_stranded_alert_hours', 6);
    const cutoff = new Date(now.getTime() - hours * 3_600_000);

    const links = await this.prisma.client.orderShipment.findMany({
      where: {
        shipment: {
          supersededAt: null,
          deletedAt: null,
          // Something the courier told us, long enough ago that a
          // momentarily out-of-order pair of scans would have settled.
          updatedAt: { lt: cutoff },
          trackingEvents: { some: {} },
        },
        order: { deletedAt: null },
      },
      select: {
        orderId: true,
        shipmentId: true,
        shipment: { select: { status: true, shipmentNumber: true, updatedAt: true } },
        order: { select: { status: true, orderNumber: true, sellerId: true } },
      },
    });

    let stranded = 0;
    for (const link of links) {
      const key = `tracking-stranded:${link.shipmentId}`;

      // What SHOULD the order be, given where the courier says the
      // parcel is? Asked of the one mapping that owns that question
      // (TRK-5) rather than restated here, so this cannot drift from
      // the rule the processor actually applies.
      const decision = this.mapping.mapScan(link.shipment.status);
      const target =
        decision.kind === 'TRANSITION' || decision.kind === 'DELIVERY_ATTEMPT'
          ? decision.targetOrderStatus
          : null;
      const allowedFrom =
        decision.kind === 'TRANSITION' || decision.kind === 'DELIVERY_ATTEMPT'
          ? decision.allowedFromOrderStatuses
          : [];

      // A TERMINAL order has deliberately stopped following its parcel:
      // an order cancelled while the box was already moving will keep
      // receiving transit scans forever, and none of them should move
      // it. Flagging those would bury the real ones — and a watchdog
      // that cries wolf gets muted. Asked of the state machine rather
      // than a list here, so a new terminal status is covered the day
      // it is added.
      const settled =
        target === null ||
        this.orders.isTerminalStatus(link.order.status) ||
        link.order.status === target ||
        allowedFrom.includes(link.order.status);
      if (settled) {
        await this.issues.resolveByKey(key, 'The order caught up with its parcel.');
        continue;
      }

      // Has the order ALREADY been where this scan says? Then the scan
      // is behind, the skip is right, and there is nothing to report.
      const beenThere = await this.prisma.client.orderEvent.count({
        where: { orderId: link.orderId, toStatus: target },
      });
      if (beenThere > 0) continue;

      stranded += 1;
      await this.issues.raise({
        kind: SystemIssueKind.TRACKING_STALLED,
        severity: SystemIssueSeverity.HIGH,
        title: `${link.order.orderNumber}: the courier says ${link.shipment.status}, the order says ${link.order.status}`,
        detail:
          `The courier has moved ${link.shipment.shipmentNumber} to ${link.shipment.status}, but ` +
          `the order is ${link.order.status} and there is no route between them — so every scan ` +
          `arriving for this parcel is being dropped, and the seller is being told something ` +
          `that is no longer true.\n\n` +
          `This is not a stale scan: the order has never been ${target}. It is a missing edge ` +
          `between the tracking mapping (TrackingStatusMappingService) and the order state ` +
          `machine, which must agree exactly (F6). Waiting will not fix it and neither will a ` +
          `retry — add the edge to both, then move this order on with a manual scan.`,
        source: 'OrderAttentionService',
        dedupeKey: key,
        metadata: {
          orderId: link.orderId,
          orderNumber: link.order.orderNumber,
          shipmentId: link.shipmentId,
          shipmentNumber: link.shipment.shipmentNumber,
          sellerId: link.order.sellerId,
          orderStatus: link.order.status,
          shipmentStatus: link.shipment.status,
          expectedOrderStatus: target,
        },
      });
    }
    return stranded;
  }

  private async checkStalledReturns(now: Date): Promise<number> {
    const hours = await this.globalInt('ops.rto_stall_alert_hours', 48);
    const cutoff = new Date(now.getTime() - hours * 3_600_000);

    const executed = await this.prisma.client.orderDeliveryActionRequest.findMany({
      where: {
        action: DeliveryActionKind.RTO,
        status: DeliveryActionStatus.EXECUTED,
        executedAt: { lt: cutoff },
      },
      select: { id: true, orderId: true, executedAt: true, sellerId: true },
    });
    if (executed.length === 0) return 0;

    const orders = await this.prisma.client.order.findMany({
      where: { id: { in: executed.map((r) => r.orderId) } },
      select: { id: true, orderNumber: true, status: true },
    });
    const byId = new Map(orders.map((o) => [o.id, o]));

    let stalled = 0;
    for (const req of executed) {
      const order = byId.get(req.orderId);
      if (order === undefined) continue;
      const key = `rto-stalled:${req.id}`;

      if (RTO_UNDERWAY.has(order.status)) {
        // It started after all. Say so rather than leaving a card that
        // a person has to work out is stale.
        await this.issues.resolveByKey(key, `The return started — order is ${order.status}.`);
        continue;
      }
      stalled += 1;
      const since = req.executedAt ?? cutoff;
      await this.issues.raise({
        kind: SystemIssueKind.INTEGRATION,
        severity: SystemIssueSeverity.HIGH,
        title: `${order.orderNumber}: the courier accepted a return that never started`,
        detail:
          `The seller asked for this parcel back on ${since.toISOString().slice(0, 16)} and the ` +
          `courier accepted, but ${hours}h later there is still no return scan — the order is ` +
          `${order.status.toLowerCase().replaceAll('_', ' ')}.\n\n` +
          'The seller believes their goods are coming back. Either the parcel was already too ' +
          'far along to stop and is still being delivered, or the cancellation was accepted and ' +
          'dropped. Check the AWB in the courier portal and tell the seller which it is.',
        source: 'OrderAttentionService',
        dedupeKey: key,
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          sellerId: req.sellerId,
          orderStatus: order.status,
          requestedAt: since.toISOString(),
        },
      });
    }
    return stalled;
  }

  /**
   * The courier handed it back and nobody received it.
   *
   * The mirror image of `checkStalledReturns`, which watches for a
   * return that never STARTED. This watches for one that finished and
   * then stopped: the parcel is at our door, the order still says
   * RTO_IN_TRANSIT, and the seller is being told their goods are on
   * their way back.
   *
   * TRK-6 makes the wait correct — only a person at the bench may say a
   * parcel is physically back, because a webhook driving RTO_RECEIVED
   * would let a bad scan trigger the restock/write-off chain with
   * nobody having seen the goods. What was missing is anybody being
   * TOLD. SD-TEST-524086 sat this way for five days and was found by a
   * person noticing an order looked wrong.
   *
   * Clears itself the moment the parcel is received, so a warehouse
   * working through the queue is not also tidying up after it.
   */
  private async checkUnreceivedReturns(now: Date): Promise<number> {
    const hours = await this.globalInt('ops.rto_receipt_alert_hours', 48);
    const cutoff = new Date(now.getTime() - hours * 3_600_000);

    // Candidates by STATUS only — the age is decided below, from the
    // courier's own scan. Filtering on `updatedAt` here was the
    // original shape and was wrong for the same reason the worklist's
    // display was: it is `@updatedAt`, so any unrelated write to the
    // row pushes a long-waiting parcel back below the cutoff and the
    // alert never fires. Silent, and permanent.
    const landed = await this.prisma.client.shipment.findMany({
      where: {
        deletedAt: null,
        status: ShipmentStatus.RTO_DELIVERED,
        supersededAt: null,
      },
      select: {
        id: true,
        shipmentNumber: true,
        awbNumber: true,
        rtoReceivedAt: true,
        updatedAt: true,
        orderShipments: {
          orderBy: { shipmentSequence: 'asc' },
          take: 1,
          select: {
            order: { select: { id: true, orderNumber: true, status: true, sellerId: true } },
          },
        },
      },
    });

    const scanAt = await this.trackingEvents.reachedStatusAt(
      landed.map((s) => s.id),
      [ShipmentStatus.RTO_DELIVERED],
    );

    let unreceived = 0;
    for (const ship of landed) {
      const order = ship.orderShipments[0]?.order;
      if (order === undefined) continue;
      const key = `rto-unreceived:${ship.id}`;

      if (ship.rtoReceivedAt !== null) {
        await this.issues.resolveByKey(key, 'The return was received at the warehouse.');
        continue;
      }

      // No scan means the status was set by hand; the row's own
      // timestamp is then the best thing available and is honest,
      // because nothing else has touched it either.
      const returnedAt = scanAt.get(ship.id) ?? ship.updatedAt;
      if (returnedAt >= cutoff) continue;

      unreceived += 1;
      await this.issues.raise({
        kind: SystemIssueKind.INTEGRATION,
        severity: SystemIssueSeverity.HIGH,
        title: `${order.orderNumber}: the courier returned this parcel and nobody has received it`,
        detail:
          `${ship.awbNumber ?? ship.shipmentNumber} was marked returned by the courier on ` +
          `${returnedAt.toISOString().slice(0, 16)}, and ${hours}h later it still has not ` +
          `been received at the warehouse — so the order is stuck at ` +
          `${order.status.toLowerCase().replaceAll('_', ' ')} and the seller is being told their ` +
          'goods are still on their way back.\n\n' +
          'Nothing moves this on its own: a return becomes RTO_RECEIVED only when somebody ' +
          'receives it at the bench, deliberately, because that is what starts the restock or ' +
          'write-off. Receive it on the RTO station — or, if it never physically arrived, chase ' +
          'the courier, because their scan says it did.',
        source: 'OrderAttentionService',
        dedupeKey: key,
        metadata: {
          shipmentId: ship.id,
          awbNumber: ship.awbNumber,
          orderId: order.id,
          orderNumber: order.orderNumber,
          sellerId: order.sellerId,
          orderStatus: order.status,
          returnedAt: returnedAt.toISOString(),
        },
      });
    }
    return unreceived;
  }

  /**
   * A cancelled order whose waybill is still live with the courier.
   *
   * A waybill is booked, and charged, at confirmation (CUR-2b). When the
   * order is then cancelled or rejected, `voidForOrder` retires the
   * shipment HERE — status CANCELLED, `deletedAt` set — but nothing tells
   * the courier. They credit the booking charge back only once the
   * waybill is cancelled with them, and a live waybill can still be
   * collected and manifested. Every such waybill was money left on the
   * courier account with nothing anywhere to say so.
   *
   * ── IT NEVER CALLS THE COURIER ───────────────────────────────────────
   * CUR-10: a lifecycle transition is a forbidden trigger for a courier
   * write, and a sweep acting on one is the same thing one step removed.
   * This names the waybill and stops; an operator cancels it from the
   * order's courier panel, which stamps `courier_cancelled_at`.
   *
   * The age is read from `deletedAt`, which `voidForOrder` sets once at
   * the void and nothing else writes — never `updatedAt` (rule 4b).
   * A MANUAL courier waybill is excluded: there is no courier account
   * for us to cancel it on or to be credited from, so an issue about it
   * could never be cleared through the system.
   *
   * Clears itself when the waybill is cancelled with the courier, or the
   * shipment stops being voided.
   */
  private async checkLiveWaybills(now: Date): Promise<number> {
    const hours = await this.globalInt('ops.cancelled_waybill_alert_hours', 2);
    const cutoff = new Date(now.getTime() - hours * 3_600_000);

    const live = await this.prisma.client.shipment.findMany({
      where: {
        status: ShipmentStatus.CANCELLED,
        awbNumber: { not: null },
        isManualCourier: false,
        courierCancelledAt: null,
      },
      select: {
        id: true,
        shipmentNumber: true,
        awbNumber: true,
        courierCode: true,
        deletedAt: true,
        updatedAt: true,
        orderShipments: {
          take: 1,
          select: {
            order: { select: { id: true, orderNumber: true, status: true, sellerId: true } },
          },
        },
      },
    });
    const liveIds = new Set(live.map((s) => s.id));

    // Clear what dropped out of the candidate set. Reached through the
    // open issues rather than the shipments, because a cancelled waybill
    // is no longer in the query above.
    const openKeys = await this.issues.openDedupeKeys(LIVE_WAYBILL_KEY_PREFIX);
    const gone = openKeys
      .map((k) => k.slice(LIVE_WAYBILL_KEY_PREFIX.length))
      .filter((id) => !liveIds.has(id));
    if (gone.length > 0) {
      const rows = await this.prisma.client.shipment.findMany({
        where: { id: { in: gone } },
        select: { id: true, courierCancelledAt: true },
      });
      const cancelledAt = new Map(rows.map((r) => [r.id, r.courierCancelledAt]));
      for (const id of gone) {
        const at = cancelledAt.get(id) ?? null;
        await this.issues.resolveByKey(
          `${LIVE_WAYBILL_KEY_PREFIX}${id}`,
          at !== null
            ? `The waybill was cancelled with the courier on ${at.toISOString().slice(0, 16)}.`
            : 'The shipment is no longer voided.',
        );
      }
    }

    let raised = 0;
    for (const ship of live) {
      const voidedAt = ship.deletedAt ?? ship.updatedAt;
      if (voidedAt >= cutoff) continue;
      const order = ship.orderShipments[0]?.order ?? null;
      const label = order?.orderNumber ?? ship.shipmentNumber;
      const awb = ship.awbNumber ?? '';

      raised += 1;
      await this.issues.raise({
        kind: SystemIssueKind.LIVE_WAYBILL,
        severity: SystemIssueSeverity.HIGH,
        title: `${label}: cancelled, but ${ship.courierCode} waybill ${awb} is still live`,
        detail:
          `${order === null ? 'This order' : `The order (now ${order.status.toLowerCase().replaceAll('_', ' ')})`} ` +
          `was called off and its shipment ${ship.shipmentNumber} voided on ` +
          `${voidedAt.toISOString().slice(0, 16)}, but waybill ${awb} was never cancelled with ` +
          `${ship.courierCode}. The courier charged it when it was booked at confirmation and ` +
          'credits it back only once it is cancelled with them — until then it is money on the ' +
          'courier account, and a live waybill can still be collected.\n\n' +
          'Open the order, expand the courier panel on the voided shipment and cancel the waybill. ' +
          'This clears itself once the courier accepts. Nothing here calls the courier on its own.',
        source: 'OrderAttentionService',
        dedupeKey: `${LIVE_WAYBILL_KEY_PREFIX}${ship.id}`,
        metadata: {
          orderId: order?.id ?? null,
          orderNumber: order?.orderNumber ?? null,
          sellerId: order?.sellerId ?? null,
          orderStatus: order?.status ?? null,
          shipmentId: ship.id,
          shipmentNumber: ship.shipmentNumber,
          awbNumber: ship.awbNumber,
          courierCode: ship.courierCode,
          voidedAt: voidedAt.toISOString(),
        },
      });
    }
    return raised;
  }

  /**
   * A waybill in the building with no shipping label stored (CUR-6).
   *
   * The AWB job fetches the label once and, on failure, retries for about
   * twenty seconds before BullMQ gives up — filing one generic per-worker
   * issue and never asking for that label again. So a courier whose
   * download link lagged, or a Spaces blip, left a booked parcel with no
   * label for good, and nothing named the parcel.
   *
   * This ASKS AGAIN first (a label fetch is a read: it books nothing,
   * CUR-10 is not engaged), through the same label-only path the operator
   * backfill uses, which refuses to book a waybill. Only a label still
   * missing an hour after its waybill raises. Pre-dispatch only — that is
   * where a missing label stops work; a parcel already with the courier is
   * the backfill's business. Clears itself once the label is stored or
   * the parcel stops needing one.
   *
   * Never throws: a failed label check must not cost the NSA half its run.
   */
  private async checkLabellessAwbs(now: Date): Promise<number> {
    try {
      const results = await this.labels.retryMissing({
        scope: 'PRE_DISPATCH',
        limit: LABEL_SWEEP_LIMIT,
        olderThan: new Date(now.getTime() - LABEL_RETRY_AFTER_MS),
      });
      const pending = results.filter((r) => r.outcome.status === 'PENDING');
      const pendingIds = new Set(pending.map((r) => r.missing.shipmentId));
      const examined = new Set(results.map((r) => r.missing.shipmentId));
      // A full page may have left some candidates unexamined; only clear
      // what this run actually looked at unless it saw everything.
      const sawEverything = results.length < LABEL_SWEEP_LIMIT;

      for (const key of await this.issues.openDedupeKeys(LABEL_MISSING_KEY_PREFIX)) {
        const id = key.slice(LABEL_MISSING_KEY_PREFIX.length);
        if (pendingIds.has(id)) continue;
        if (!examined.has(id) && !sawEverything) continue;
        await this.issues.resolveByKey(
          key,
          'The label is stored now, or the parcel no longer needs one here.',
        );
      }

      let raised = 0;
      for (const { missing: m, outcome } of pending) {
        const since = m.awbGeneratedAt ?? m.createdAt;
        if (now.getTime() - since.getTime() < LABEL_ALERT_AFTER_MS) continue;
        const error = outcome.status === 'PENDING' ? outcome.errorMessage : null;
        const label = m.orderNumber ?? m.shipmentNumber;
        raised += 1;
        await this.issues.raise({
          kind: SystemIssueKind.INTEGRATION,
          severity: SystemIssueSeverity.HIGH,
          title: `${label}: ${m.courierCode} waybill ${m.awbNumber} has no shipping label stored`,
          detail:
            `Shipment ${m.shipmentNumber} was booked with ${m.courierCode} on ` +
            `${since.toISOString().slice(0, 16)} and no label was ever stored for it, so the ` +
            'pack bench has nothing to print or scan. The label was asked for again just now and ' +
            `failed: ${error ?? 'no reason given'}.\n\n` +
            'This retries every hour and clears itself once a label is stored. To try at once, ' +
            'POST /admin/courier/awb-labels/backfill with {"dryRun":false}. Nothing here books a ' +
            'waybill.',
          source: 'OrderAttentionService',
          dedupeKey: `${LABEL_MISSING_KEY_PREFIX}${m.shipmentId}`,
          metadata: {
            orderId: m.orderId,
            orderNumber: m.orderNumber,
            shipmentId: m.shipmentId,
            shipmentNumber: m.shipmentNumber,
            awbNumber: m.awbNumber,
            courierCode: m.courierCode,
            awbSince: since.toISOString(),
            lastError: error,
          },
        });
      }
      return raised;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Label watchdog failed this run; the rest of the sweep continues',
      );
      return 0;
    }
  }

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
