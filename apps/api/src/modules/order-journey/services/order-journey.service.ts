import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderEventType, OrderStatus, ShipmentStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  NslInterpretationService,
  type NslMeaning,
} from '../../tracking-events/services/nsl-interpretation.service';

export type MilestoneOwner = 'SKYDROP' | 'COURIER';
export type MilestoneState = 'DONE' | 'CURRENT' | 'PENDING' | 'SKIPPED';

export interface JourneyMilestone {
  readonly key: string;
  readonly label: string;
  /** Who performs it — the warehouse, or the courier. */
  readonly owner: MilestoneOwner;
  readonly at: Date | null;
  readonly state: MilestoneState;
  /** One line of context: the facility, the agent's outcome, the ETA. */
  readonly detail: string | null;
  /** True when `at` is a PROMISE rather than something that happened. */
  readonly estimated: boolean;
}

export interface JourneyEntry {
  readonly at: Date;
  readonly owner: MilestoneOwner;
  readonly title: string;
  readonly detail: string | null;
  readonly location: string | null;
  /** The courier's own code for this scan, where they gave one. */
  readonly nslCode: string | null;
  readonly rawStatus: string | null;
  /**
   * A failed delivery, when this line IS one.
   *
   * Attached to the scan rather than emitted as a second entry: the
   * webhook processor writes the attempt row and the tracking event for
   * the SAME real-world moment (TRK-2), so merging both as lines would
   * print every failed delivery twice.
   */
  readonly attempt: {
    readonly number: number;
    readonly reason: string | null;
    readonly notes: string | null;
    readonly nextAttemptAt: Date | null;
    /** The driver who tried. Delhivery supplies this so the shipper can
     *  follow up, and it has been captured and shown to nobody. */
    readonly agentName: string | null;
    readonly agentPhone: string | null;
    /** Did the driver reach the customer, and what did they say. */
    readonly contactedCustomer: boolean | null;
    readonly customerResponse: string | null;
    /** The courier's own code, and what it means — including whether a
     *  re-attempt can even be asked for on it. */
    readonly nsl: NslMeaning | null;
  } | null;
}

export interface JourneyParcel {
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly awbNumber: string | null;
  readonly courierCode: string;
  /**
   * WHICH of our accounts with that courier carried it (CACC-1).
   *
   * One courier can be several accounts, and every later question about
   * this parcel — the label, the tracking match, the cancel, whose
   * wallet the fee came out of — is answered from that account. When a
   * parcel goes wrong, "which account was it on" is the first thing
   * asked and it was nowhere on the page.
   */
  readonly courierAccountLabel: string | null;
  readonly status: ShipmentStatus;
  /** What the SELLER declared. */
  readonly declaredWeightGrams: number | null;
  /** What the COURIER weighed and will bill on. The one that matters. */
  readonly chargeableWeightGrams: number | null;
  readonly dimensionsCm: string | null;
  readonly expectedDeliveryAt: Date | null;
  /** What WE told the courier to collect. */
  readonly collectableAmountInr: string | null;
  /** What the COURIER says they will collect. Shown beside ours only
   *  when they disagree — a silent mismatch is money. */
  readonly courierCollectableInr: string | null;
  readonly paymentMode: string;
  readonly courierPickedUpAt: Date | null;
  readonly courierSortCode: string | null;
  readonly courierStatusLine: string | null;
  readonly courierStatusLocation: string | null;
}

export interface OrderJourney {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly orderStatus: OrderStatus;
  readonly milestones: readonly JourneyMilestone[];
  readonly parcels: readonly JourneyParcel[];
  readonly timeline: readonly JourneyEntry[];
}

/**
 * The whole life of an order in one place — ours and the courier's.
 *
 * ── THE PROBLEM THIS SOLVES ──────────────────────────────────────────
 * A seller looking at an order saw two disconnected things: a list of
 * courier scans, and a "timeline" holding whatever order_events
 * happened to be visible — often a single line. Everything Skydrop
 * itself did to the parcel (took the order, phoned the customer, picked
 * it, packed it, handed it over) was either missing or unreadable, and
 * the courier's own panel showed a clearer picture of our operation
 * than we did.
 *
 * ── WHY MILESTONES ARE DERIVED, NOT STORED ───────────────────────────
 * Every fact here already exists — in `order_events` (append-only,
 * ORD-4), on the shipment's operational columns, and in
 * `tracking_events`. A `milestones` table would be a fourth copy that
 * can disagree with the three, and the disagreement would surface as a
 * seller being told their parcel was packed when it was not. So this
 * READS, and owns no state.
 *
 * ── EVIDENCE ORDER MATTERS ───────────────────────────────────────────
 * `order_events` is the authority for our own stages, because it is the
 * append-only record of the transition actually happening. The
 * shipment's columns are the FALLBACK — orders created before an event
 * was emitted, or by a path that stamped the column directly, still
 * have a true timestamp there. Taking the shipment column first would
 * mean showing when a stamp was written rather than when the order
 * moved.
 */
@Injectable()
export class OrderJourneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nsl: NslInterpretationService,
  ) {}

  /**
   * @param sellerId when given, the order must belong to them — this is
   *   the tenant boundary, applied in the QUERY rather than checked
   *   after, so a miss is indistinguishable from a non-existent order.
   */
  async forOrder(orderId: string, sellerId: string | null): Promise<OrderJourney> {
    const order = await this.prisma.client.order.findFirst({
      where: {
        id: orderId,
        deletedAt: null,
        ...(sellerId === null ? {} : { sellerId }),
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentMode: true,
        codAmountInr: true,
        placedAt: true,
        createdAt: true,
        events: {
          // ── THE SELLER SEES ONLY WHAT WAS MARKED FOR THEM ──────────
          // `isVisibleToSeller` DEFAULTS TO FALSE (see
          // OrderEventWriterService), so an unfiltered read is not a
          // slightly-wider view — it is every internal note, override
          // and operational transition we ever wrote about the order.
          // The endpoint this replaced filtered here; omitting it made
          // the journey a way around that.
          ...(sellerId === null ? {} : { where: { isVisibleToSeller: true } }),
          select: {
            type: true,
            toStatus: true,
            description: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        orderShipments: {
          select: {
            shipment: {
              select: {
                id: true,
                shipmentNumber: true,
                awbNumber: true,
                courierCode: true,
                courierAccount: { select: { label: true } },
                status: true,
                declaredWeightGrams: true,
                totalWeightGrams: true,
                chargeableWeightGrams: true,
                lengthCm: true,
                widthCm: true,
                heightCm: true,
                codAmountInr: true,
                expectedDeliveryAt: true,
                courierCollectableInr: true,
                courierPickedUpAt: true,
                courierSortCode: true,
                courierStatusLine: true,
                courierStatusLocation: true,
                pickCompletedAt: true,
                packCompletedAt: true,
                awbGeneratedAt: true,
                deliveryAttempts: {
                  select: {
                    attemptNumber: true,
                    attemptedAt: true,
                    outcome: true,
                    failureReason: true,
                    failureNotes: true,
                    nextAttemptScheduledAt: true,
                    agentName: true,
                    agentPhone: true,
                    contactedCustomer: true,
                    customerResponse: true,
                    courierNslCode: true,
                  },
                  orderBy: { attemptedAt: 'asc' },
                },
                trackingEvents: {
                  select: {
                    eventAt: true,
                    status: true,
                    description: true,
                    locationName: true,
                    locationCity: true,
                    nslCode: true,
                    rawCourierStatus: true,
                    isVisibleToCustomer: true,
                  },
                  orderBy: { eventAt: 'asc' },
                },
              },
            },
          },
          orderBy: { shipmentSequence: 'asc' },
        },
      },
    });

    if (order === null) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'No order found with that reference',
      });
    }

    // The LIVE parcel: a superseded shipment's scans belong to a parcel
    // that no longer exists, and mixing them into one story is how a
    // customer reads a cancelled leg as their own.
    const shipments = order.orderShipments.map((s) => s.shipment);
    const live = shipments[shipments.length - 1] ?? null;

    const scans = live?.trackingEvents ?? [];
    const firstEventTo = (status: OrderStatus): Date | null =>
      order.events.find((e) => e.toStatus === status)?.createdAt ?? null;
    const firstScan = (status: ShipmentStatus): (typeof scans)[number] | null =>
      scans.find((s) => s.status === status) ?? null;

    const milestones = this.buildMilestones({
      orderStatus: order.status,
      placedAt: order.placedAt ?? order.createdAt,
      firstEventTo,
      firstScan,
      pickCompletedAt: live?.pickCompletedAt ?? null,
      packCompletedAt: live?.packCompletedAt ?? null,
      awbGeneratedAt: live?.awbGeneratedAt ?? null,
      expectedDeliveryAt: live?.expectedDeliveryAt ?? null,
      // The agent's own words from the most recent call. This is the
      // step no courier panel has, so the detail is worth carrying.
      lastCallEvent:
        [...order.events].reverse().find((e) => e.type === OrderEventType.CALL_LOGGED)
          ?.description ?? null,
    });

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderStatus: order.status,
      milestones,
      parcels: shipments.map((s) => ({
        shipmentId: s.id,
        shipmentNumber: s.shipmentNumber,
        awbNumber: s.awbNumber,
        courierCode: s.courierCode,
        courierAccountLabel: s.courierAccount?.label ?? null,
        status: s.status,
        declaredWeightGrams: s.declaredWeightGrams ?? s.totalWeightGrams,
        chargeableWeightGrams: s.chargeableWeightGrams,
        dimensionsCm:
          s.lengthCm === null || s.widthCm === null || s.heightCm === null
            ? null
            : `${s.lengthCm.toString()} × ${s.widthCm.toString()} × ${s.heightCm.toString()}`,
        expectedDeliveryAt: s.expectedDeliveryAt,
        // The shipment's own COD is what the courier was TOLD to
        // collect; the order's is what we bill on. They should agree,
        // and the parcel's is the one the customer will be asked for.
        collectableAmountInr: (s.codAmountInr ?? order.codAmountInr)?.toFixed(2) ?? null,
        courierCollectableInr: s.courierCollectableInr?.toFixed(2) ?? null,
        paymentMode: order.paymentMode,
        courierPickedUpAt: s.courierPickedUpAt,
        courierSortCode: s.courierSortCode,
        courierStatusLine: s.courierStatusLine,
        courierStatusLocation: s.courierStatusLocation,
      })),
      timeline: this.buildTimeline(order.events, scans, live?.deliveryAttempts ?? []),
    };
  }

  /**
   * The ladder, in the order a parcel actually travels it.
   *
   * Times come from the earliest EVIDENCE of the stage, and the state
   * is derived from whether a later stage has a time rather than from
   * the order's current status alone — an order sitting in
   * DELIVERY_FAILED has still been packed, and a ladder that read only
   * the current status would show every earlier rung as pending.
   */
  private buildMilestones(input: {
    orderStatus: OrderStatus;
    placedAt: Date;
    firstEventTo: (s: OrderStatus) => Date | null;
    firstScan: (
      s: ShipmentStatus,
    ) => { eventAt: Date; description: string | null; locationName: string | null } | null;
    pickCompletedAt: Date | null;
    packCompletedAt: Date | null;
    awbGeneratedAt: Date | null;
    expectedDeliveryAt: Date | null;
    lastCallEvent: string | null;
  }): JourneyMilestone[] {
    const inTransit = input.firstScan(ShipmentStatus.IN_TRANSIT);
    const ofd = input.firstScan(ShipmentStatus.OUT_FOR_DELIVERY);
    const delivered = input.firstScan(ShipmentStatus.DELIVERED);

    const raw: Array<Omit<JourneyMilestone, 'state'>> = [
      {
        key: 'order_received',
        label: 'Order received',
        owner: 'SKYDROP',
        at: input.placedAt,
        detail: null,
        estimated: false,
      },
      {
        key: 'call_confirmed',
        label: 'Confirmed by phone',
        owner: 'SKYDROP',
        at: input.firstEventTo(OrderStatus.CONFIRMED),
        // The step no courier panel has, and the one that decides
        // whether a COD parcel is worth sending at all.
        detail: input.lastCallEvent,
        estimated: false,
      },
      {
        key: 'picked',
        label: 'Picked from shelf',
        owner: 'SKYDROP',
        at: input.firstEventTo(OrderStatus.PICKED) ?? input.pickCompletedAt,
        detail: null,
        estimated: false,
      },
      {
        key: 'packed',
        label: 'Packed',
        owner: 'SKYDROP',
        at: input.firstEventTo(OrderStatus.PACKED) ?? input.packCompletedAt,
        detail: null,
        estimated: false,
      },
      {
        key: 'ready_to_dispatch',
        label: 'Ready to dispatch',
        owner: 'SKYDROP',
        at: input.firstEventTo(OrderStatus.PENDING_DISPATCH) ?? input.awbGeneratedAt,
        detail: null,
        estimated: false,
      },
      {
        key: 'dispatched',
        label: 'Handed to courier',
        owner: 'SKYDROP',
        at: input.firstEventTo(OrderStatus.DISPATCHED),
        detail: null,
        estimated: false,
      },
      {
        key: 'in_transit',
        label: 'In transit',
        owner: 'COURIER',
        at: inTransit?.eventAt ?? input.firstEventTo(OrderStatus.IN_TRANSIT),
        detail: this.scanLine(inTransit),
        estimated: false,
      },
      {
        key: 'out_for_delivery',
        label: 'Out for delivery',
        owner: 'COURIER',
        at: ofd?.eventAt ?? input.firstEventTo(OrderStatus.OUT_FOR_DELIVERY),
        detail: this.scanLine(ofd),
        estimated: false,
      },
      {
        key: 'delivered',
        label: 'Delivered',
        owner: 'COURIER',
        // Falls back to the courier's ETA so the last rung carries a
        // date before it happens — which is the question a seller is
        // actually asking when they open the page.
        at:
          delivered?.eventAt ??
          input.firstEventTo(OrderStatus.DELIVERED) ??
          input.expectedDeliveryAt,
        detail: this.scanLine(delivered),
        estimated: delivered === null && input.firstEventTo(OrderStatus.DELIVERED) === null,
      },
    ];

    // CURRENT is the last rung with a real time; everything after it is
    // pending. An estimated Delivered is never "current" — nothing has
    // happened yet.
    let currentIdx = -1;
    raw.forEach((m, i) => {
      if (m.at !== null && !m.estimated) currentIdx = i;
    });

    return raw.map((m, i) => ({
      ...m,
      state:
        i < currentIdx
          ? // A rung with no time that a LATER rung has passed was
            // genuinely skipped — an order confirmed straight from an
            // admin override never had a call. Saying so is better than
            // showing it as still pending forever.
            m.at === null
            ? 'SKIPPED'
            : 'DONE'
          : i === currentIdx
            ? 'CURRENT'
            : 'PENDING',
    }));
  }

  private scanLine(
    scan: { description: string | null; locationName: string | null } | null,
  ): string | null {
    if (scan === null) return null;
    const parts = [scan.description, scan.locationName].filter(
      (p): p is string => p !== null && p.trim() !== '',
    );
    return parts.length === 0 ? null : parts.join(' · ');
  }

  /**
   * Our events and their scans, in ONE list, newest first.
   *
   * Merged rather than shown side by side because the parcel had one
   * life: "packed at 14:02, handed over at 15:11, picked up by the
   * driver at 16:23" is a story, and the same facts in two panels is a
   * reconciliation exercise for the reader.
   */
  private buildTimeline(
    events: ReadonlyArray<{
      type: OrderEventType;
      toStatus: OrderStatus | null;
      description: string | null;
      createdAt: Date;
    }>,
    scans: ReadonlyArray<{
      eventAt: Date;
      status: ShipmentStatus;
      description: string | null;
      locationName: string | null;
      locationCity: string | null;
      nslCode: string | null;
      rawCourierStatus: string | null;
      isVisibleToCustomer: boolean;
    }>,
    attempts: ReadonlyArray<{
      attemptNumber: number;
      attemptedAt: Date;
      failureReason: string | null;
      failureNotes: string | null;
      nextAttemptScheduledAt: Date | null;
      agentName: string | null;
      agentPhone: string | null;
      contactedCustomer: boolean | null;
      customerResponse: string | null;
      courierNslCode: string | null;
    }>,
  ): JourneyEntry[] {
    // ── ONE LINE PER REAL-WORLD MOMENT ────────────────────────────────
    // The webhook processor writes the delivery_attempts row and the
    // tracking_event for the SAME failed delivery (TRK-2, attempt
    // FIRST). Emitting both as timeline lines would print every failed
    // delivery twice — so the attempt ENRICHES its scan instead.
    //
    // Matched to the minute, which is the same tolerance the tracking
    // page already uses: the two rows are written in one saga but not
    // in one statement, so their timestamps agree to the minute rather
    // than to the millisecond.
    const minute = (d: Date): string => d.toISOString().slice(0, 16);
    const byMinute = new Map<string, (typeof attempts)[number]>();
    for (const a of attempts) byMinute.set(minute(a.attemptedAt), a);
    const claimed = new Set<string>();

    const asAttempt = (a: (typeof attempts)[number]): JourneyEntry['attempt'] => ({
      number: a.attemptNumber,
      reason: a.failureReason,
      notes: a.failureNotes,
      nextAttemptAt: a.nextAttemptScheduledAt,
      agentName: a.agentName,
      agentPhone: a.agentPhone,
      contactedCustomer: a.contactedCustomer,
      customerResponse: a.customerResponse,
      nsl: this.nsl.interpret(a.courierNslCode),
    });
    const ours: JourneyEntry[] = events.map((e) => ({
      at: e.createdAt,
      owner: 'SKYDROP',
      title: e.toStatus === null ? humanizeEventType(e.type) : humanizeStatus(e.toStatus),
      detail: e.description,
      location: null,
      nslCode: null,
      rawStatus: null,
      attempt: null,
    }));

    const theirs: JourneyEntry[] = scans
      // UNMAPPABLE and audit-only scans are marked invisible by the M10
      // processor; they are for us, not for a seller reading a story.
      .filter((s) => s.isVisibleToCustomer)
      .map((s) => {
        const hit = byMinute.get(minute(s.eventAt)) ?? null;
        if (hit !== null) claimed.add(minute(s.eventAt));
        return {
          at: s.eventAt,
          owner: 'COURIER' as const,
          title: s.description ?? humanizeStatus(s.status),
          detail: s.description === null ? null : humanizeStatus(s.status),
          location: s.locationName ?? s.locationCity,
          nslCode: s.nslCode,
          rawStatus: s.rawCourierStatus,
          attempt: hit === null ? null : asAttempt(hit),
        };
      });

    // An attempt with NO scan to attach to still has to appear. A
    // manually-recorded attempt (TRK-9) has no scan by construction,
    // and dropping it would lose the reason a delivery failed — which
    // is the single most useful line on the page when one does.
    const orphaned: JourneyEntry[] = attempts
      .filter((a) => !claimed.has(minute(a.attemptedAt)))
      .map((a) => ({
        at: a.attemptedAt,
        owner: 'COURIER' as const,
        title: `Delivery attempt ${String(a.attemptNumber)}`,
        detail: a.failureReason,
        location: null,
        nslCode: null,
        rawStatus: null,
        attempt: asAttempt(a),
      }));

    return [...ours, ...theirs, ...orphaned].sort((a, b) => b.at.getTime() - a.at.getTime());
  }
}

/** `PENDING_CONFIRMATION` → `Pending confirmation`. */
function humanizeStatus(s: string): string {
  const lower = s.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function humanizeEventType(t: string): string {
  return humanizeStatus(t);
}
