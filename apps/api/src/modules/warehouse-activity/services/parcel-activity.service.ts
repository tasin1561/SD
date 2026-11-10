import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SHORT_PICK_ACTION } from '../../warehouse-printing/services/short-pick';
import {
  actorForEvent,
  actorForStaffId,
  UNRECORDED_ACTOR,
  type StaffNameRow,
  type TrailActor,
} from './warehouse-actor';

/**
 * The parcel activity trail — WHO did what to this order's parcels.
 *
 * ── READ-ONLY, AND A READING PROBLEM BY DESIGN ───────────────────────
 * Every fact here was already recorded. This service writes NOTHING and
 * adds no column: it reads the operational who/when stamps the stations
 * already keep (`shipments.*ByStaffId`, `pick_batches.printed_by`,
 * `pack_boxes.packer`, `awb_labels.generated_by`, `manifests.closed_by`)
 * and, for the two steps that have no actor column of their own, the
 * append-only `order_events` row that drove the transition. Nothing is
 * re-recorded anywhere, so MUST NOT #3 is untouched.
 *
 * ── WMS-9 AND WHY READING THESE COLUMNS IS ALLOWED HERE ──────────────
 * WMS-9 forbids a cross-module reader querying `shipments.*` operational
 * columns TO MAKE DECISIONS. This module makes none: it renders a
 * history for a human and nothing branches on what it returns. Same
 * posture as `order-journey`, which reads the same shipment row for the
 * same reason — one story, assembled where it is read, so no second copy
 * can disagree with the stations.
 *
 * ── TENANCY ──────────────────────────────────────────────────────────
 * Staff-only, across clients, and it carries NOTHING client-shaped: no
 * seller id or name, no recipient, no money, no SKU. A staff member's
 * display name is fine (same employer); a client's is not, and a client
 * who drove a step reads as "the client" with no name attached.
 */

export type ParcelActivityKind =
  | 'LABEL_GENERATED'
  | 'LABEL_PRINTED'
  | 'PICK_BATCH_CREATED'
  | 'PICK_BATCH_PRINTED'
  | 'PICK_CLAIMED'
  | 'PICKED_SHORT'
  | 'PICKED'
  | 'PACK_BOX_OPENED'
  | 'PACK_BOX_CLOSED'
  | 'PACK_BOX_CANCELLED'
  | 'PACKED'
  | 'COURIER_CHOSEN'
  | 'MANIFEST_CLOSED'
  | 'MANIFEST_HANDOFF_CONFIRMED'
  | 'HANDOVER_SCANNED'
  | 'COURIER_PICKED_UP'
  | 'RTO_RECEIVED'
  | 'RTO_INSPECTED';

export interface ParcelActivityEvent {
  /** Stable across refetches so the list can key on it. */
  readonly key: string;
  readonly kind: ParcelActivityKind;
  readonly atIso: string;
  /**
   * True when the time is the best evidence we have rather than a stamp
   * of the act itself (the screen says "about"). Only the RTO
   * inspection, which records WHO decided but not WHEN.
   */
  readonly atApproximate: boolean;
  readonly actor: TrailActor;
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly awbNumber: string | null;
  /** Numbers and counts the row shows beside the step. Never free text. */
  readonly detail: Readonly<Record<string, string | number>> | null;
}

export interface ParcelActivityParcel {
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly awbNumber: string | null;
  /** A parcel replaced by a later one (a re-dispatch) — still shown. */
  readonly superseded: boolean;
  /** The most recent step on this parcel, for the one-line bench read. */
  readonly lastTouch: ParcelActivityEvent | null;
}

/** The one-line answer for a bench screen: who last touched this parcel. */
export interface ParcelLastTouch {
  readonly shipmentId: string;
  readonly kind: ParcelActivityKind;
  readonly atIso: string;
  readonly actor: TrailActor;
}

export interface ParcelActivityTrail {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly parcels: readonly ParcelActivityParcel[];
  /** Oldest first — the order the work happened in. */
  readonly events: readonly ParcelActivityEvent[];
}

/**
 * Lifecycle rank, used only to break a TIE on the timestamp — two stamps
 * written in one transaction share a millisecond, and "packed" sorting
 * above "box closed" would read as the work happening backwards.
 */
const RANK: Readonly<Record<ParcelActivityKind, number>> = {
  LABEL_GENERATED: 0,
  LABEL_PRINTED: 1,
  PICK_BATCH_CREATED: 2,
  PICK_BATCH_PRINTED: 3,
  PICK_CLAIMED: 4,
  PICKED_SHORT: 5,
  PICKED: 6,
  PACK_BOX_OPENED: 7,
  PACK_BOX_CANCELLED: 8,
  PACK_BOX_CLOSED: 9,
  PACKED: 10,
  COURIER_CHOSEN: 11,
  MANIFEST_CLOSED: 12,
  MANIFEST_HANDOFF_CONFIRMED: 13,
  HANDOVER_SCANNED: 14,
  COURIER_PICKED_UP: 15,
  RTO_RECEIVED: 16,
  RTO_INSPECTED: 17,
};

/** The line a short-pick audit row describes, or null if it is malformed. */
function shortLine(metadata: unknown): { itemId: string; found: number; expected: number } | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const { shipmentItemId, found, expected } = metadata as Record<string, unknown>;
  if (typeof shipmentItemId !== 'string') return null;
  if (typeof found !== 'number' || typeof expected !== 'number') return null;
  return { itemId: shipmentItemId, found, expected };
}

const COURIER_ACTOR: TrailActor = { kind: 'COURIER', name: null };

@Injectable()
export class ParcelActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async forOrder(orderId: string): Promise<ParcelActivityTrail> {
    const order = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true },
    });
    if (order === null) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
    }

    const shipments = await this.prisma.client.shipment.findMany({
      where: { orderShipments: { some: { orderId } } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        shipmentNumber: true,
        awbNumber: true,
        supersededAt: true,
        labelPrintedAt: true,
        labelPrintedByStaffId: true,
        labelPrintCount: true,
        pickStartedAt: true,
        pickStartedByStaffId: true,
        pickCompletedAt: true,
        packCompletedAt: true,
        packedByStaffId: true,
        courierChosenAt: true,
        courierChosenByStaffId: true,
        handoverScannedAt: true,
        handoverScannedByStaffId: true,
        pickedUpByCourierAt: true,
        rtoReceivedAt: true,
        pickBatch: {
          select: {
            batchNumber: true,
            createdAt: true,
            createdByStaffId: true,
            printedAt: true,
            printedByStaffId: true,
            printCount: true,
          },
        },
        manifest: {
          select: {
            manifestNumber: true,
            closedAt: true,
            closedByStaffId: true,
            handoffConfirmedAt: true,
            handoffConfirmedByStaffId: true,
          },
        },
        awbLabels: {
          orderBy: { version: 'asc' },
          select: {
            id: true,
            version: true,
            generatedAt: true,
            generatedByStaffId: true,
            generatedReason: true,
            printedCount: true,
          },
        },
        packBoxes: {
          orderBy: { openedAt: 'asc' },
          select: {
            id: true,
            packerStaffId: true,
            status: true,
            openedAt: true,
            closedAt: true,
            cancelledAt: true,
          },
        },
        items: {
          select: {
            id: true,
            rtoDisposedByStaffId: true,
            updatedAt: true,
            rtoInspections: { select: { createdAt: true } },
          },
        },
      },
    });

    // The two steps with NO actor column: who closed the batch walk
    // (`pickCompletedAt`) and who received the return (`rtoReceivedAt`).
    // The append-only transition row already knows, so it is read rather
    // than a new column being written.
    const transitions = await this.prisma.client.orderEvent.findMany({
      where: { orderId, toStatus: { in: [OrderStatus.PICKED, OrderStatus.RTO_RECEIVED] } },
      orderBy: { createdAt: 'asc' },
      select: { toStatus: true, actorType: true, actorId: true },
    });
    // Short picks: written by the picker as append-only audit rows (the
    // parcel is the entity, the line is in the metadata). Read-only here.
    // Newest row per line wins — a picker who found more later supersedes.
    const shortRows = await this.prisma.client.auditLog.findMany({
      where: {
        action: SHORT_PICK_ACTION,
        entityType: 'shipment',
        entityId: { in: shipments.map((s) => s.id) },
      },
      orderBy: { createdAt: 'asc' },
      select: { entityId: true, actorType: true, actorId: true, metadata: true, createdAt: true },
    });
    const shortByLine = new Map<string, (typeof shortRows)[number]>();
    for (const r of shortRows) {
      const line = shortLine(r.metadata);
      if (line !== null && r.entityId !== null) shortByLine.set(`${r.entityId}:${line.itemId}`, r);
    }

    const lastTransition = (to: OrderStatus): (typeof transitions)[number] | null => {
      const matching = transitions.filter((e) => e.toStatus === to);
      return matching[matching.length - 1] ?? null;
    };

    const names = await this.staffNames([
      ...shipments.flatMap((s) => [
        s.labelPrintedByStaffId,
        s.pickStartedByStaffId,
        s.packedByStaffId,
        s.courierChosenByStaffId,
        s.handoverScannedByStaffId,
        s.pickBatch?.createdByStaffId ?? null,
        s.pickBatch?.printedByStaffId ?? null,
        s.manifest?.closedByStaffId ?? null,
        s.manifest?.handoffConfirmedByStaffId ?? null,
        ...s.awbLabels.map((l) => l.generatedByStaffId),
        ...s.packBoxes.map((b) => b.packerStaffId),
        ...s.items.map((i) => i.rtoDisposedByStaffId),
      ]),
      ...transitions.map((e) => e.actorId),
      ...[...shortByLine.values()].map((r) => r.actorId),
    ]);

    const events: ParcelActivityEvent[] = [];
    for (const s of shipments) {
      const base = {
        shipmentId: s.id,
        shipmentNumber: s.shipmentNumber,
        awbNumber: s.awbNumber,
      };
      const push = (
        kind: ParcelActivityKind,
        at: Date | null,
        actor: TrailActor,
        detail: Readonly<Record<string, string | number>> | null,
        suffix?: string,
      ): void => {
        if (at === null) return;
        events.push({
          key: `${s.id}:${kind}${suffix === undefined ? '' : `:${suffix}`}`,
          kind,
          atIso: at.toISOString(),
          atApproximate: false,
          actor,
          detail,
          ...base,
        });
      };

      for (const label of s.awbLabels) {
        push(
          'LABEL_GENERATED',
          label.generatedAt,
          actorForStaffId(label.generatedByStaffId, names),
          { version: label.version, reason: label.generatedReason, printed: label.printedCount },
          label.id,
        );
      }
      push('LABEL_PRINTED', s.labelPrintedAt, actorForStaffId(s.labelPrintedByStaffId, names), {
        sheets: s.labelPrintCount,
      });
      if (s.pickBatch !== null) {
        const batch = s.pickBatch;
        push(
          'PICK_BATCH_CREATED',
          batch.createdAt,
          actorForStaffId(batch.createdByStaffId, names),
          { batchNumber: batch.batchNumber },
        );
        push(
          'PICK_BATCH_PRINTED',
          batch.printedAt,
          actorForStaffId(batch.printedByStaffId, names),
          { batchNumber: batch.batchNumber, sheets: batch.printCount },
        );
      }
      push('PICK_CLAIMED', s.pickStartedAt, actorForStaffId(s.pickStartedByStaffId, names), null);
      // A short pick is the picker's own statement. The actor is the
      // audit row's, shown as recorded — never inferred from the claim.
      for (const [lineKey, row] of shortByLine) {
        if (!lineKey.startsWith(`${s.id}:`)) continue;
        const line = shortLine(row.metadata);
        if (line === null) continue;
        push(
          'PICKED_SHORT',
          row.createdAt,
          actorForEvent(row.actorType, row.actorId, names),
          { found: line.found, expected: line.expected },
          line.itemId,
        );
      }
      // No `pickCompletedByStaffId` exists. The PICKED transition row is
      // the record; with neither, the step reads as unrecorded rather
      // than guessing at the person who claimed it.
      const picked = lastTransition(OrderStatus.PICKED);
      push(
        'PICKED',
        s.pickCompletedAt,
        picked === null ? UNRECORDED_ACTOR : actorForEvent(picked.actorType, picked.actorId, names),
        null,
      );
      for (const box of s.packBoxes) {
        const packer = actorForStaffId(box.packerStaffId, names);
        push('PACK_BOX_OPENED', box.openedAt, packer, null, box.id);
        push('PACK_BOX_CLOSED', box.closedAt, packer, null, box.id);
        push('PACK_BOX_CANCELLED', box.cancelledAt, packer, null, box.id);
      }
      push('PACKED', s.packCompletedAt, actorForStaffId(s.packedByStaffId, names), null);
      push(
        'COURIER_CHOSEN',
        s.courierChosenAt,
        actorForStaffId(s.courierChosenByStaffId, names),
        null,
      );
      if (s.manifest !== null) {
        const manifest = s.manifest;
        push(
          'MANIFEST_CLOSED',
          manifest.closedAt,
          actorForStaffId(manifest.closedByStaffId, names),
          { manifestNumber: manifest.manifestNumber },
        );
        push(
          'MANIFEST_HANDOFF_CONFIRMED',
          manifest.handoffConfirmedAt,
          actorForStaffId(manifest.handoffConfirmedByStaffId, names),
          { manifestNumber: manifest.manifestNumber },
        );
      }
      push(
        'HANDOVER_SCANNED',
        s.handoverScannedAt,
        actorForStaffId(s.handoverScannedByStaffId, names),
        null,
      );
      // The courier collected it — there is no staff member to name, and
      // saying "system" would be a worse lie than saying "the courier".
      push('COURIER_PICKED_UP', s.pickedUpByCourierAt, COURIER_ACTOR, null);
      const rto = lastTransition(OrderStatus.RTO_RECEIVED);
      push(
        'RTO_RECEIVED',
        s.rtoReceivedAt,
        rto === null ? UNRECORDED_ACTOR : actorForEvent(rto.actorType, rto.actorId, names),
        null,
      );
      const inspected = this.rtoInspection(s.items, names);
      if (inspected !== null) events.push({ ...inspected, ...base });
    }

    events.sort(
      (a, b) =>
        Date.parse(a.atIso) - Date.parse(b.atIso) ||
        RANK[a.kind] - RANK[b.kind] ||
        a.key.localeCompare(b.key),
    );

    const parcels = shipments.map((s) => {
      const own = events.filter((e) => e.shipmentId === s.id);
      return {
        shipmentId: s.id,
        shipmentNumber: s.shipmentNumber,
        awbNumber: s.awbNumber,
        superseded: s.supersededAt !== null,
        lastTouch: own[own.length - 1] ?? null,
      };
    });

    return { orderId: order.id, orderNumber: order.orderNumber, parcels, events };
  }

  /**
   * Who last touched each of these parcels — the one line a bench screen
   * has room for.
   *
   * Deliberately NOT the whole trail per row: a bench list of forty
   * parcels asking for forty trails would be forty round trips to render
   * one sentence each. Same columns, same actor rules, one query.
   *
   * A step whose actor nothing records (the batch pick's
   * `pickCompletedAt`) is skipped here rather than reported with no
   * name: the sentence on a bench row is "who has been at this", and
   * "nobody recorded" is a fact for the trail, not for a row somebody
   * reads while holding a box. The parcel's own trail still shows it.
   */
  async lastTouchFor(shipmentIds: readonly string[]): Promise<readonly ParcelLastTouch[]> {
    if (shipmentIds.length === 0) return [];
    const shipments = await this.prisma.client.shipment.findMany({
      where: { id: { in: [...shipmentIds] } },
      select: {
        id: true,
        labelPrintedAt: true,
        labelPrintedByStaffId: true,
        pickStartedAt: true,
        pickStartedByStaffId: true,
        packCompletedAt: true,
        packedByStaffId: true,
        handoverScannedAt: true,
        handoverScannedByStaffId: true,
        packBoxes: {
          orderBy: { openedAt: 'desc' },
          take: 1,
          select: {
            packerStaffId: true,
            openedAt: true,
            closedAt: true,
            cancelledAt: true,
          },
        },
      },
    });

    const names = await this.staffNames(
      shipments.flatMap((s) => [
        s.labelPrintedByStaffId,
        s.pickStartedByStaffId,
        s.packedByStaffId,
        s.handoverScannedByStaffId,
        ...s.packBoxes.map((b) => b.packerStaffId),
      ]),
    );

    const out: ParcelLastTouch[] = [];
    for (const s of shipments) {
      const box = s.packBoxes[0] ?? null;
      const candidates: Array<{
        readonly kind: ParcelActivityKind;
        readonly at: Date | null;
        readonly staffId: string | null;
      }> = [
        { kind: 'LABEL_PRINTED', at: s.labelPrintedAt, staffId: s.labelPrintedByStaffId },
        { kind: 'PICK_CLAIMED', at: s.pickStartedAt, staffId: s.pickStartedByStaffId },
        { kind: 'PACKED', at: s.packCompletedAt, staffId: s.packedByStaffId },
        {
          kind: 'HANDOVER_SCANNED',
          at: s.handoverScannedAt,
          staffId: s.handoverScannedByStaffId,
        },
        ...(box === null
          ? []
          : [
              { kind: 'PACK_BOX_OPENED' as const, at: box.openedAt, staffId: box.packerStaffId },
              { kind: 'PACK_BOX_CLOSED' as const, at: box.closedAt, staffId: box.packerStaffId },
              {
                kind: 'PACK_BOX_CANCELLED' as const,
                at: box.cancelledAt,
                staffId: box.packerStaffId,
              },
            ]),
      ];
      let best: { kind: ParcelActivityKind; at: Date; staffId: string | null } | null = null;
      for (const c of candidates) {
        if (c.at === null) continue;
        if (
          best === null ||
          c.at.getTime() > best.at.getTime() ||
          (c.at.getTime() === best.at.getTime() && RANK[c.kind] > RANK[best.kind])
        ) {
          best = { kind: c.kind, at: c.at, staffId: c.staffId };
        }
      }
      if (best === null) continue;
      out.push({
        shipmentId: s.id,
        kind: best.kind,
        atIso: best.at.toISOString(),
        actor: actorForStaffId(best.staffId, names),
      });
    }
    return out;
  }

  /**
   * One RTO inspection row per parcel: who decided, and the best time we
   * have for it.
   *
   * `shipment_items.rto_disposed_by_staff_id` has NO paired timestamp, so
   * the time comes from the inspection rows written in the same call
   * (WMS-8d) and falls back to the line's `updatedAt` — flagged
   * `atApproximate`, because a row's update time is evidence of when the
   * line last changed, not a stamp of the act.
   */
  private rtoInspection(
    items: ReadonlyArray<{
      readonly id: string;
      readonly rtoDisposedByStaffId: string | null;
      readonly updatedAt: Date;
      readonly rtoInspections: ReadonlyArray<{ readonly createdAt: Date }>;
    }>,
    names: ReadonlyMap<string, StaffNameRow>,
  ): Omit<ParcelActivityEvent, 'shipmentId' | 'shipmentNumber' | 'awbNumber'> | null {
    const inspected = items.filter((i) => i.rtoDisposedByStaffId !== null);
    if (inspected.length === 0) return null;
    let latest: (typeof inspected)[number] | null = null;
    let latestAt = 0;
    let approximate = false;
    for (const item of inspected) {
      const rowTimes = item.rtoInspections.map((r) => r.createdAt.getTime());
      const at = rowTimes.length === 0 ? item.updatedAt.getTime() : Math.max(...rowTimes);
      if (latest === null || at >= latestAt) {
        latest = item;
        latestAt = at;
        approximate = rowTimes.length === 0;
      }
    }
    if (latest === null) return null;
    return {
      key: `${latest.id}:RTO_INSPECTED`,
      kind: 'RTO_INSPECTED',
      atIso: new Date(latestAt).toISOString(),
      atApproximate: approximate,
      actor: actorForStaffId(latest.rtoDisposedByStaffId, names),
      detail: { lines: inspected.length },
    };
  }

  /** ids → rows, deduped and null-free. Soft-deleted staff INCLUDED. */
  private async staffNames(
    ids: ReadonlyArray<string | null>,
  ): Promise<ReadonlyMap<string, StaffNameRow>> {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.client.staffUser.findMany({
      where: { id: { in: unique } },
      // Soft-deleted on purpose: the act was still theirs, and a blank
      // row would quietly rewrite who did the work.
      select: { id: true, emailDisplay: true, email: true, deletedAt: true },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }
}
