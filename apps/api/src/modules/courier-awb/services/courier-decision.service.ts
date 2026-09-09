import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ActorType, OrderStatus, SystemIssueKind } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderWriteService } from '../../order/services/order-write.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import type { CourierOption } from '../../courier-shared/services/courier-option-selection.service';
import { CourierOptionSelectionService } from '../../courier-shared/services/courier-option-selection.service';
import { AwbGenerationJobService } from './awb-generation-job.service';

const TTL_KEY = 'courier.selection_decision_ttl_hours';

export interface WaitingParcel {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly sellerId: string;
  readonly sellerCompanyName: string;
  readonly recipientName: string;
  readonly destCity: string;
  readonly destPostalCode: string;
  readonly totalWeightGrams: number;
  readonly codAmountInr: string | null;
  readonly waitingSince: Date;
  readonly options: readonly CourierOption[];
  readonly optionsFetchedAt: Date | null;
}

/**
 * CUR-17 — the desk where a person picks the carrier.
 *
 * Reads what is waiting, records a choice, and re-runs the booking. The
 * TTL sweep at the bottom is the half that matters most: a decision
 * queue nobody watches is a queue that silently holds parcels, and the
 * seller who set the policy is not the person who would notice.
 */
@Injectable()
export class CourierDecisionService {
  private readonly logger = new Logger(CourierDecisionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly orderWrite: OrderWriteService,
    private readonly awbJob: AwbGenerationJobService,
    private readonly selection: CourierOptionSelectionService,
    private readonly issues: SystemIssueService,
    private readonly settings: SettingsResolverService,
  ) {}

  /** Everything sitting in AWAITING_COURIER, oldest first — the order a
   *  queue is worked in, and the one that makes the oldest wait the
   *  most visible rather than the least. */
  async listWaiting(): Promise<WaitingParcel[]> {
    const rows = await this.prisma.client.order.findMany({
      where: { status: OrderStatus.AWAITING_COURIER, deletedAt: null },
      orderBy: { updatedAt: 'asc' },
      take: 200,
      select: {
        id: true,
        orderNumber: true,
        updatedAt: true,
        sellerId: true,
        seller: { select: { companyName: true } },
        recipientName: true,
        orderShipments: {
          orderBy: { shipmentSequence: 'asc' },
          select: {
            shipment: {
              select: {
                id: true,
                shipmentNumber: true,
                supersededAt: true,
                destCity: true,
                destPostalCode: true,
                totalWeightGrams: true,
                codAmountInr: true,
                courierOptions: true,
                courierOptionsFetchedAt: true,
              },
            },
          },
        },
      },
    });

    const out: WaitingParcel[] = [];
    for (const o of rows) {
      // The LIVE shipment, never the retired one. A supersede leaves the
      // old row in place by design (CUR-7), and offering an operator a
      // choice for a parcel that no longer exists books nothing.
      const live = o.orderShipments.map((s) => s.shipment).find((s) => s.supersededAt === null);
      if (!live) continue;
      out.push({
        orderId: o.id,
        orderNumber: o.orderNumber,
        shipmentId: live.id,
        shipmentNumber: live.shipmentNumber,
        sellerId: o.sellerId,
        sellerCompanyName: o.seller.companyName,
        recipientName: o.recipientName,
        destCity: live.destCity,
        destPostalCode: live.destPostalCode,
        totalWeightGrams: live.totalWeightGrams,
        codAmountInr: live.codAmountInr?.toString() ?? null,
        waitingSince: o.updatedAt,
        options: parseOptions(live.courierOptions),
        optionsFetchedAt: live.courierOptionsFetchedAt,
      });
    }
    return out;
  }

  /**
   * A person picks. The stamp lands FIRST and the booking follows.
   *
   * Visible-vs-silent, the same ordering as manual placement: a crash
   * between leaves a parcel whose carrier IS chosen and which is still
   * in AWAITING_COURIER — a state that says "re-run me" and converges
   * on a retry, rather than one that says a booking happened when it
   * did not.
   */
  async choose(input: {
    readonly shipmentId: string;
    readonly courierCompanyId: number;
    readonly staffId: string;
  }): Promise<{ readonly orderId: string; readonly result: string }> {
    const shipment = await this.prisma.client.shipment.findUnique({
      where: { id: input.shipmentId },
      select: {
        id: true,
        supersededAt: true,
        awbNumber: true,
        courierOptions: true,
        orderShipments: {
          orderBy: { shipmentSequence: 'asc' },
          take: 1,
          select: { orderId: true, order: { select: { status: true } } },
        },
      },
    });
    if (!shipment) {
      throw new NotFoundException({ code: 'SHIPMENT_NOT_FOUND', message: 'No such shipment' });
    }
    if (shipment.supersededAt !== null) {
      throw new BadRequestException({
        code: 'SHIPMENT_SUPERSEDED',
        message: 'This parcel was retired and replaced; choose on the replacement',
      });
    }
    if (shipment.awbNumber !== null) {
      // CUR-9. A second booking is a second real waybill and a second
      // charge; the choice arrived too late and saying so is the only
      // honest answer.
      throw new BadRequestException({
        code: 'AWB_ALREADY_GENERATED',
        message: 'This parcel already has a waybill; the carrier can no longer be changed here',
      });
    }
    const link = shipment.orderShipments[0];
    if (!link) {
      throw new BadRequestException({
        code: 'SHIPMENT_HAS_NO_ORDER',
        message: 'This parcel is not attached to an order',
      });
    }
    if (link.order.status !== OrderStatus.AWAITING_COURIER) {
      throw new BadRequestException({
        code: 'ORDER_NOT_AWAITING_COURIER',
        message: `This order is ${link.order.status}; it is not waiting for a carrier`,
      });
    }

    // The chosen id must be one WE offered. Accepting an arbitrary
    // number would send the aggregator a carrier that was never quoted
    // for this lane, and their refusal would arrive as a booking
    // failure with nothing pointing at the cause.
    const options = parseOptions(shipment.courierOptions);
    const picked = options.find((o) => o.courierCompanyId === input.courierCompanyId);
    if (picked === undefined) {
      throw new BadRequestException({
        code: 'COURIER_NOT_OFFERED',
        message: 'That carrier was not among the ones offered for this parcel',
      });
    }

    return this.commit(shipment.id, link.orderId, picked, {
      actorType: ActorType.STAFF,
      actorId: input.staffId,
    });
  }

  /**
   * ── THE TTL SWEEP ────────────────────────────────────────────────
   *
   * A parcel waiting on a decision is a parcel not moving, and the
   * person who set the policy is not the person watching the queue. So
   * after `courier.selection_decision_ttl_hours` we pick the CHEAPEST
   * ourselves and raise a HIGH issue saying we did.
   *
   * Cheapest rather than fastest: choosing on somebody's behalf should
   * spend the least of their money, and the parcel is already late by
   * definition — an extra day costs less than an unexplained premium.
   *
   * The issue is the point. Auto-picking QUIETLY would make a MANUAL
   * policy indistinguishable from CHEAPEST for anybody not watching,
   * and the seller would keep believing they were choosing.
   */
  async sweepExpired(): Promise<{ readonly picked: number; readonly skipped: number }> {
    const waiting = await this.listWaiting();

    let picked = 0;
    let skipped = 0;
    for (const w of waiting) {
      // SET-1, per seller. A seller who chose MANUAL may reasonably
      // want longer to answer than the default, and resolving the TTL
      // globally would silently override a setting we told them they
      // could change. One lookup per waiting parcel is nothing on a
      // queue that is normally empty.
      const hours = await this.ttlHours(w.sellerId);
      if (w.waitingSince >= new Date(Date.now() - hours * 3_600_000)) continue;

      // No options recorded means there is nothing to choose from — the
      // booking will go out with the carrier's own ranking, which is
      // what an empty list meant in the first place.
      const outcome = this.selection.select(w.options, 'CHEAPEST', 5);
      if (outcome.kind !== 'CHOSEN') {
        skipped += 1;
        continue;
      }
      try {
        await this.commit(w.shipmentId, w.orderId, outcome.option, {
          actorType: ActorType.SYSTEM,
          actorId: null,
        });
        await this.issues.raise({
          kind: SystemIssueKind.COURIER_DECISION,
          severity: 'HIGH',
          source: 'CourierDecisionService.sweepExpired',
          dedupeKey: `courier-decision-timeout:${w.shipmentId}`,
          title: `We chose the courier for ${w.orderNumber} because nobody did`,
          detail:
            `${w.sellerCompanyName}'s policy says a person picks the carrier, and this parcel ` +
            `waited ${hours}h without one. It has been booked with ${outcome.option.courierName} ` +
            `at ₹${outcome.option.rateInr} — the cheapest that was offered. If that is the wrong ` +
            `answer, the parcel can still be cancelled with the courier before it is collected.`,
          metadata: {
            orderId: w.orderId,
            shipmentId: w.shipmentId,
            sellerId: w.sellerId,
            chosen: outcome.option.courierName,
            courierCompanyId: outcome.option.courierCompanyId,
            rateInr: outcome.option.rateInr,
            waitedHours: hours,
          },
        });
        picked += 1;
      } catch (err) {
        // Per-parcel isolation: one that will not book must not stop
        // the sweep reaching the rest of the queue.
        skipped += 1;
        this.logger.error(
          { shipmentId: w.shipmentId, err: err instanceof Error ? err.message : String(err) },
          'could not auto-pick a courier for an expired decision',
        );
      }
    }
    return { picked, skipped };
  }

  /** Stamp the choice, un-pause the order, book. */
  private async commit(
    shipmentId: string,
    orderId: string,
    option: CourierOption,
    actor: { actorType: ActorType; actorId: string | null },
  ): Promise<{ readonly orderId: string; readonly result: string }> {
    await this.prisma.client.shipment.update({
      where: { id: shipmentId },
      data: {
        chosenCourierCompanyId: option.courierCompanyId,
        // Null for the sweep on purpose: nobody chose, and recording a
        // staff member who did not act is a false record of who decided
        // — the same distinction the auto-pickup and handover-scan
        // gates already draw. The audit row and the issue say it was
        // automatic.
        courierChosenByStaffId: actor.actorType === ActorType.STAFF ? actor.actorId : null,
        courierChosenAt: new Date(),
      },
    });

    await this.audit.log({
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: 'courier.carrier_chosen',
      entityType: 'shipment',
      entityId: shipmentId,
      severity: 'MEDIUM',
      metadata: {
        orderId,
        courierCompanyId: option.courierCompanyId,
        courierName: option.courierName,
        rateInr: option.rateInr,
        estimatedDays: option.estimatedDays,
        automatic: actor.actorType === ActorType.SYSTEM,
      },
    });

    await this.orderWrite.transitionStatus({
      orderId,
      to: OrderStatus.CONFIRMED,
      actor: { type: actor.actorType, id: actor.actorId },
      expectedFrom: OrderStatus.AWAITING_COURIER,
      reason: `Carrier chosen: ${option.courierName}`,
    });

    // Booking is the LAST step and its failure is reported, not
    // swallowed: the choice is already durable, so a retry re-enters
    // here and books with the same carrier (the stamp short-circuits
    // the policy).
    const r = await this.awbJob.processOrder(orderId);
    return { orderId, result: r.result };
  }

  /** FAILS OPEN to the default: a settings outage must not make every
   *  waiting parcel look expired, nor make none of them. */
  private async ttlHours(sellerId: string): Promise<number> {
    try {
      const r = await this.settings.resolve(sellerId, TTL_KEY);
      return typeof r.value === 'number' && r.value > 0 ? r.value : 6;
    } catch {
      return 6;
    }
  }
}

/** `courierOptions` is a Json column, so anything could be in it. A row
 *  that does not parse yields an empty list rather than throwing —
 *  reading a malformed record must not take out the whole queue. */
function parseOptions(raw: unknown): CourierOption[] {
  if (!Array.isArray(raw)) return [];
  const out: CourierOption[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.courierCompanyId !== 'number' || typeof o.courierName !== 'string') continue;
    out.push({
      courierCompanyId: o.courierCompanyId,
      courierName: o.courierName,
      rateInr: typeof o.rateInr === 'number' ? o.rateInr : 0,
      estimatedDays: typeof o.estimatedDays === 'number' ? o.estimatedDays : null,
      etd: typeof o.etd === 'string' ? o.etd : null,
    });
  }
  return out;
}
