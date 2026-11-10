import { Injectable } from '@nestjs/common';
import { PackBoxStatus, PickBatchStatus, ShipmentStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { actorForStaffId, type StaffNameRow, type TrailActor } from './warehouse-actor';

/**
 * Who is holding what, RIGHT NOW — the live half of the activity trail.
 *
 * ── THE QUESTION THIS ANSWERS ────────────────────────────────────────
 * With several packers and printers on one floor, the question asked
 * mid-shift is not "who packed this yesterday" but "who has this now,
 * and can I take it?". Two people can then sort it out between
 * themselves instead of shouting across the warehouse.
 *
 * ── AN EXPIRED HOLD IS FREE, AND SAYING OTHERWISE SENDS SOMEBODY ON A
 *    WALK FOR NOTHING ───────────────────────────────────────────────
 * Every claim in this system self-expires in the ELIGIBILITY PREDICATE
 * (`pack_claim_expires_at <= now()`, `pickStartedAt IS NULL` after the
 * WMS-5 sweep, the five-minute `pack_boxes` reclaim) rather than by a
 * sweeper that tidies the row. So the row sits there, populated, long
 * after the hold stopped meaning anything. This service therefore
 * computes `expired` against `now` and the screen renders "free to
 * take", never the stale name. `stuck` is the subset worth chasing: a
 * hold whose window ran out more than STUCK_AFTER_MINUTES ago, which is
 * what "someone went home mid-box" looks like from here.
 *
 * ── ABSOLUTE TIMES ONLY ──────────────────────────────────────────────
 * `sinceIso` / `untilIso` are instants. The console renders a CLOCK
 * TIME, never "in 23 minutes": this board is re-read five minutes later
 * without a refetch and a relative time would have gone silently stale.
 *
 * ── READ-ONLY, AND IT WRITES NOTHING ─────────────────────────────────
 * Including `shipments.pack_claimed_by_staff_id` / `pack_claim_expires_at`
 * (PACK-4), which are owned and written by the pack queue alone. Null
 * everywhere is a perfectly good answer here and renders as no claim.
 *
 * ── TENANCY ──────────────────────────────────────────────────────────
 * Floor-wide across clients, staff-only, and nothing client-shaped
 * travels: the parcel's own numbers, the warehouse, and a staff name.
 */

/** A hold older than its window by this much is somebody to go and find. */
export const STUCK_AFTER_MINUTES = 15;

/** How many rows of each kind the board carries. Oldest hold first. */
const PAGE = 60;

export type FloorHoldKind = 'PICK' | 'PACK_CLAIM' | 'PACK_BOX' | 'PICK_BATCH';

export interface FloorHold {
  readonly key: string;
  readonly kind: FloorHoldKind;
  readonly holder: TrailActor;
  /** The parcel, where the hold is on one. */
  readonly shipmentNumber: string | null;
  readonly awbNumber: string | null;
  readonly orderId: string | null;
  readonly orderNumber: string | null;
  /** The picking sheet, where the hold is on one. */
  readonly batchNumber: string | null;
  readonly warehouseName: string | null;
  /** When the hold was taken. Null when nothing records it. */
  readonly sinceIso: string | null;
  /** When it lapses. Null when the hold has no window at all. */
  readonly untilIso: string | null;
  /** The window has passed: this is FREE, whatever the row still says. */
  readonly expired: boolean;
  /** Expired long enough ago to be worth chasing the holder about. */
  readonly stuck: boolean;
  readonly detail: Readonly<Record<string, string | number>> | null;
}

/**
 * A label printed more than once. NOT a hold — a label is printed, not
 * held, and inventing a holder for it would be a lie. Two sheets for one
 * parcel in the building is its own operational signal and is reported
 * as exactly that.
 */
export interface LabelReprint {
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly awbNumber: string | null;
  readonly orderId: string | null;
  readonly orderNumber: string | null;
  readonly warehouseName: string | null;
  readonly sheets: number;
  /** Who printed it LAST — the column keeps one, not a history. */
  readonly lastPrintedBy: TrailActor;
  readonly lastPrintedAtIso: string | null;
  /** Labels generated for this parcel, which is a different count. */
  readonly labelVersions: number;
}

export interface FloorHoldsView {
  /** The instant every `expired` here was judged against. */
  readonly nowIso: string;
  readonly stuckAfterMinutes: number;
  readonly holds: readonly FloorHold[];
  readonly reprints: readonly LabelReprint[];
}

@Injectable()
export class WarehouseHoldsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<FloorHoldsView> {
    const now = new Date();
    const live = { deletedAt: null, supersededAt: null } as const;

    const parcel = {
      id: true,
      shipmentNumber: true,
      awbNumber: true,
      originWarehouse: { select: { name: true } },
      orderShipments: {
        orderBy: { shipmentSequence: 'asc' },
        take: 1,
        select: { orderId: true, order: { select: { orderNumber: true } } },
      },
    } as const;

    const [pickClaims, packClaims, openBoxes, batches, reprintRows] = await Promise.all([
      this.prisma.client.shipment.findMany({
        where: {
          ...live,
          status: ShipmentStatus.CREATED,
          pickStartedAt: { not: null },
          pickCompletedAt: null,
        },
        orderBy: { pickStartedAt: 'asc' },
        take: PAGE,
        select: {
          ...parcel,
          pickStartedAt: true,
          pickExpiresAt: true,
          pickStartedByStaffId: true,
        },
      }),
      this.prisma.client.shipment.findMany({
        where: { ...live, packClaimedByStaffId: { not: null }, packCompletedAt: null },
        orderBy: { packClaimExpiresAt: 'asc' },
        take: PAGE,
        select: {
          ...parcel,
          packClaimedByStaffId: true,
          packClaimExpiresAt: true,
          packStartedAt: true,
        },
      }),
      this.prisma.client.packBox.findMany({
        where: { status: PackBoxStatus.OPEN },
        orderBy: { openedAt: 'asc' },
        take: PAGE,
        select: {
          id: true,
          packerStaffId: true,
          openedAt: true,
          expiresAt: true,
          orderId: true,
          order: { select: { orderNumber: true } },
          shipment: {
            select: {
              shipmentNumber: true,
              awbNumber: true,
              originWarehouse: { select: { name: true } },
            },
          },
          scans: { select: { id: true } },
        },
      }),
      this.prisma.client.pickBatch.findMany({
        where: { status: PickBatchStatus.PRINTED },
        orderBy: { printedAt: 'asc' },
        take: PAGE,
        select: {
          id: true,
          batchNumber: true,
          printedAt: true,
          printedByStaffId: true,
          printCount: true,
          warehouse: { select: { name: true } },
          shipments: { select: { pickCompletedAt: true } },
        },
      }),
      this.prisma.client.shipment.findMany({
        where: {
          ...live,
          labelPrintCount: { gt: 1 },
          // Still in the building: once the courier has it, a second
          // sheet is history rather than something to go and find.
          pickedUpByCourierAt: null,
        },
        orderBy: { labelPrintedAt: 'desc' },
        take: PAGE,
        select: {
          ...parcel,
          labelPrintCount: true,
          labelPrintedAt: true,
          labelPrintedByStaffId: true,
          awbLabels: { select: { id: true } },
        },
      }),
    ]);

    const names = await this.staffNames([
      ...pickClaims.map((s) => s.pickStartedByStaffId),
      ...packClaims.map((s) => s.packClaimedByStaffId),
      ...openBoxes.map((b) => b.packerStaffId),
      ...batches.map((b) => b.printedByStaffId),
      ...reprintRows.map((s) => s.labelPrintedByStaffId),
    ]);

    const holds: FloorHold[] = [
      ...pickClaims.map((s) =>
        this.hold({
          key: `PICK:${s.id}`,
          kind: 'PICK',
          holder: actorForStaffId(s.pickStartedByStaffId, names),
          shipmentNumber: s.shipmentNumber,
          awbNumber: s.awbNumber,
          orderId: s.orderShipments[0]?.orderId ?? null,
          orderNumber: s.orderShipments[0]?.order.orderNumber ?? null,
          warehouseName: s.originWarehouse.name,
          since: s.pickStartedAt,
          until: s.pickExpiresAt,
          detail: null,
          now,
        }),
      ),
      ...packClaims.map((s) =>
        this.hold({
          key: `PACK_CLAIM:${s.id}`,
          kind: 'PACK_CLAIM',
          holder: actorForStaffId(s.packClaimedByStaffId, names),
          shipmentNumber: s.shipmentNumber,
          awbNumber: s.awbNumber,
          orderId: s.orderShipments[0]?.orderId ?? null,
          orderNumber: s.orderShipments[0]?.order.orderNumber ?? null,
          warehouseName: s.originWarehouse.name,
          // PACK-4 records WHO holds the claim and UNTIL WHEN, but not
          // when it was taken. `packStartedAt` is the first open box,
          // which is a different act, so it is only used when there IS
          // one — otherwise the board shows no start time rather than
          // the wrong one.
          since: s.packStartedAt,
          until: s.packClaimExpiresAt,
          detail: null,
          now,
        }),
      ),
      ...openBoxes.map((b) =>
        this.hold({
          key: `PACK_BOX:${b.id}`,
          kind: 'PACK_BOX',
          holder: actorForStaffId(b.packerStaffId, names),
          shipmentNumber: b.shipment.shipmentNumber,
          awbNumber: b.shipment.awbNumber,
          orderId: b.orderId,
          orderNumber: b.order.orderNumber,
          warehouseName: b.shipment.originWarehouse.name,
          since: b.openedAt,
          until: b.expiresAt,
          detail: { scanned: b.scans.length },
          now,
        }),
      ),
      ...batches.map((b) => {
        const unpicked = b.shipments.filter((s) => s.pickCompletedAt === null).length;
        return this.hold({
          key: `PICK_BATCH:${b.id}`,
          kind: 'PICK_BATCH',
          holder: actorForStaffId(b.printedByStaffId, names),
          shipmentNumber: null,
          awbNumber: null,
          orderId: null,
          orderNumber: null,
          batchNumber: b.batchNumber,
          warehouseName: b.warehouse.name,
          since: b.printedAt,
          // A printed sheet has no expiry: it is paper in somebody's
          // hand until the walk is marked done. Saying "free at 14:20"
          // would be invented.
          until: null,
          detail: { unpicked, of: b.shipments.length, sheets: b.printCount },
          now,
        });
      }),
    ];

    const reprints: LabelReprint[] = reprintRows.map((s) => ({
      shipmentId: s.id,
      shipmentNumber: s.shipmentNumber,
      awbNumber: s.awbNumber,
      orderId: s.orderShipments[0]?.orderId ?? null,
      orderNumber: s.orderShipments[0]?.order.orderNumber ?? null,
      warehouseName: s.originWarehouse.name,
      sheets: s.labelPrintCount,
      lastPrintedBy: actorForStaffId(s.labelPrintedByStaffId, names),
      lastPrintedAtIso: s.labelPrintedAt === null ? null : s.labelPrintedAt.toISOString(),
      labelVersions: s.awbLabels.length,
    }));

    // Stuck first, then expired, then the oldest live hold — the order
    // somebody scanning this screen wants to read it in.
    holds.sort(
      (a, b) =>
        Number(b.stuck) - Number(a.stuck) ||
        Number(b.expired) - Number(a.expired) ||
        (a.sinceIso ?? '').localeCompare(b.sinceIso ?? '') ||
        a.key.localeCompare(b.key),
    );

    return {
      nowIso: now.toISOString(),
      stuckAfterMinutes: STUCK_AFTER_MINUTES,
      holds,
      reprints,
    };
  }

  /** The one place `expired` and `stuck` are decided. */
  private hold(input: {
    readonly key: string;
    readonly kind: FloorHoldKind;
    readonly holder: TrailActor;
    readonly shipmentNumber: string | null;
    readonly awbNumber: string | null;
    readonly orderId: string | null;
    readonly orderNumber: string | null;
    readonly batchNumber?: string | null;
    readonly warehouseName: string | null;
    readonly since: Date | null;
    readonly until: Date | null;
    readonly detail: Readonly<Record<string, string | number>> | null;
    readonly now: Date;
  }): FloorHold {
    const expired = input.until !== null && input.until.getTime() <= input.now.getTime();
    const overdueMinutes =
      input.until === null ? 0 : (input.now.getTime() - input.until.getTime()) / 60_000;
    return {
      key: input.key,
      kind: input.kind,
      holder: input.holder,
      shipmentNumber: input.shipmentNumber,
      awbNumber: input.awbNumber,
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      batchNumber: input.batchNumber ?? null,
      warehouseName: input.warehouseName,
      sinceIso: input.since === null ? null : input.since.toISOString(),
      untilIso: input.until === null ? null : input.until.toISOString(),
      expired,
      stuck: expired && overdueMinutes >= STUCK_AFTER_MINUTES,
      detail: input.detail,
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
      select: { id: true, emailDisplay: true, email: true, deletedAt: true },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }
}
