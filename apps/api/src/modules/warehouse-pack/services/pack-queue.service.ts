import { Injectable, Logger } from '@nestjs/common';
import { InventoryMode } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { InventoryModeService } from '../../inventory-shared/inventory-mode.service';
import { OrderReadService, type ResolvedOrder } from '../../order/services/order-read.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface PulledPackItem {
  shipmentItemId: string;
  orderItemId: string;
  variantId: string;
  skuCode: string;
  productName: string;
  variantLabel: string | null;
  quantity: number;
  unitWeightGrams: number | null;
  pickedBinId: string | null;
  pickedBatchId: string | null;
  /**
   * R4 — STRICT means `PackService.complete` demands the scanned serial
   * SET equal this parcel's PICKED units (UNIT-2); a packer screen that
   * cannot see this offers no scan field and the parcel is refused at
   * the end with nothing it can do about it.
   */
  inventoryMode: InventoryMode;
}

export interface PulledPack {
  shipmentId: string;
  shipmentNumber: string;
  orderId: string;
  courierCode: string;
  pickCompletedAt: Date | null;
  items: PulledPackItem[];
  order: ResolvedOrder | null;
}

/**
 * Module 8 — pack pull (commit 9). The packer-facing analogue of
 * PickQueueService.pullNext.
 *
 * **PACK-4 (2026-11-10, owner: more than two packers and printers now
 * run all day). The pull CLAIMS, and the claim EXPIRES.** This comment
 * used to say pack was intentionally claim-free, that two packers
 * pulling SEQUENTIALLY both saw the same shipment, and that the race was
 * resolved at `complete` (or, since PACK-1, at `PackBoxService.open`)
 * with a 409 for the loser — "rare at Phase 1A volume, revisit if pack
 * volume scales". It scaled. Nothing was ever corrupted by it, because
 * the pack box's partial unique indexes refuse the second packer; what
 * it cost was the WALK — both packers were told to pack the same parcel
 * and the second one found out at the bench, holding the goods.
 *
 * So the queue now reads TWO exclusions, and neither can strand a
 * parcel:
 *
 *   1. A LIVE OPEN BOX held by another packer (`pack_boxes`, PACK-1 —
 *      the authoritative claim, and the only one a scan obeys). Scoped
 *      `expires_at > now()` so an abandoned box stops hiding the parcel
 *      the moment it is due, whether or not the five-minute sweep has
 *      run yet, and scoped `packer_staff_id <> me` so a packer who has
 *      to come back to their own box (the STRICT resume, LBL-4) still
 *      sees their parcel.
 *   2. A LIVE PULL CLAIM held by another packer
 *      (`shipments.pack_claimed_by_staff_id` / `pack_claim_expires_at`,
 *      `ops.pack_claim_minutes`). Written by the pull itself, inside the
 *      ONE `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)`
 *      statement that selects it — never a read-then-write.
 *
 * The claim is deliberately SOFT: `pack_boxes` remains the authority and
 * **what a scan accepts is unchanged** — a packer physically holding a
 * label may always open its box, claim or no claim. The claim's only job
 * is to stop the QUEUE offering one parcel to two people. It is also
 * deliberately PREDICATE-EXPIRED rather than swept by a job: a parcel
 * whose claimant went home is eligible again the instant the deadline
 * passes, with no worker to be down and no admin to intervene.
 *
 * `releaseClaim` is the explicit "not this one" — a packer putting a
 * parcel back does not have to wait out the deadline.
 *
 * Eligibility: shipment CREATED + pack_completed_at IS NULL AND the
 * shipment's order is in PICKED (WMS-9 — order status is the
 * authoritative gate; PICKED means the pick is done, ready to pack).
 * FIFO = `s.created_at ASC` (provisioning order). `FOR UPDATE OF s`
 * restricts row locking to `shipments` only (the orders join stays
 * read-only — no contention with OrderWriteService.transitionStatus).
 *
 * R0 (revised-plan roadmap): optional `courierCode` filter so a
 * packer can segregate parcels by destination courier while packing
 * (previously plain FIFO across all couriers). `courierCode` is
 * user-supplied, so it's passed as a bound parameter to
 * `$queryRawUnsafe`, never string-interpolated into the SQL text.
 */
/**
 * What "waiting to be packed" means, written once.
 *
 * `pullNext` and the queue LIST must agree exactly: a bench that lists
 * a parcel a pull would not find, or finds one the list never showed,
 * is a packer walking to a shelf for nothing. The order-status
 * predicate is the authority (WMS-2), not a proxy —
 * `ShipmentProvisionService.voidForOrder` is best-effort, so a lagged
 * void has to be excluded here rather than assumed away.
 *
 * Alias-parameterised because the PACK-4 claim is taken by an
 * `UPDATE … WHERE id = (SELECT …)`, whose inner select needs its own
 * alias. One predicate, three call sites, no chance of the list and the
 * pull drifting apart.
 */
const packEligibleSql = (s: string, o: string): string => `${s}.status = 'created'
             AND ${s}.pack_completed_at IS NULL
             AND ${s}.deleted_at IS NULL
             AND ${o}.deleted_at IS NULL
             AND ${o}.status = 'picked'`;

/**
 * PACK-4 — and it is MINE or FREE.
 *
 * Both halves are per-operator and both expire by themselves. `$1` is
 * always the asking packer's staff id; everything a pull or a list shows
 * is therefore something that packer may actually act on.
 */
const PACK_UNCLAIMED_SQL = (s: string): string => `
             AND NOT EXISTS (
               SELECT 1 FROM pack_boxes pb
                WHERE pb.shipment_id = ${s}.id
                  AND pb.status = 'open'
                  AND pb.expires_at > now()
                  AND pb.packer_staff_id <> $1::uuid
             )
             AND (
               ${s}.pack_claim_expires_at IS NULL
               OR ${s}.pack_claim_expires_at <= now()
               OR ${s}.pack_claimed_by_staff_id = $1::uuid
             )`;

/** `ops.pack_claim_minutes` — how long a pulled parcel stays off the
 *  other benches. Shorter than the box timeout on purpose: a pull is an
 *  intention, a box is work in progress. */
const CLAIM_SETTING = 'ops.pack_claim_minutes';
const DEFAULT_CLAIM_MINUTES = 10;

/** One parcel on the bench's waiting list. */
export interface WaitingPack {
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly courierCode: string;
  readonly awbNumber: string | null;
  readonly orderNumber: string | null;
  readonly recipientName: string | null;
  /** Null means no label has been printed — it cannot be scanned in. */
  readonly labelPrintedAtIso: string | null;
  readonly pickCompletedAtIso: string | null;
  readonly itemCount: number;
}

/**
 * A parcel the asking packer is NOT offered, and why.
 *
 * The exclusions could simply have hidden these rows, but a parcel
 * disappearing off a bench list with no explanation is its own kind of
 * confusing — the packer saw it a minute ago and now cannot find it. So
 * the queue answers both halves: what is yours to take, and what
 * somebody else already has.
 */
export interface PackInProgress {
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly awbNumber: string | null;
  readonly orderNumber: string | null;
  /** 'BOX' = a box is open on their bench; 'CLAIM' = the queue handed it
   *  to them and no box has been opened yet. */
  readonly hold: 'BOX' | 'CLAIM';
  readonly heldByStaffId: string;
  /** Who, as a person reads it — never a uuid on a screen. */
  readonly heldByName: string | null;
  /** When the hold lapses on its own. Nothing has to be done to it. */
  readonly heldUntilIso: string;
}

export interface PackQueueView {
  readonly waiting: WaitingPack[];
  readonly inProgress: PackInProgress[];
}

@Injectable()
export class PackQueueService {
  private readonly logger = new Logger(PackQueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderReadService,
    private readonly modes: InventoryModeService,
  ) {}

  /**
   * Everything waiting to be packed, oldest first.
   *
   * The bench had a scan box and nothing else, so a packer could not see
   * what was coming — only find out one parcel at a time by scanning a
   * label already in their hand. This is the same set `pullNext` draws
   * from, through the same predicate, so the list and the pull can never
   * disagree.
   *
   * No claim and no lock: it is a view, and locking rows to render them
   * would block the packers actually working. `labelPrintedAt` is
   * carried because a parcel with no label cannot be scanned in at all —
   * that is the one thing on this list somebody has to act on before the
   * bench can do anything with it.
   *
   * PACK-4: `staffId` is what makes this list THIS packer's. A parcel
   * another bench holds is not in `waiting`; it is in `inProgress` with
   * a name and a deadline on it.
   */
  async listWaiting(staffId: string, courierCode?: string, limit = 100): Promise<WaitingPack[]> {
    const rows = await this.prisma.client.$queryRawUnsafe<
      Array<{
        id: string;
        shipment_number: string;
        courier_code: string;
        awb_number: string | null;
        label_printed_at: Date | null;
        pick_completed_at: Date | null;
        order_number: string | null;
        recipient_name: string | null;
        item_count: bigint;
      }>
    >(
      `SELECT s.id,
              s.shipment_number,
              s.courier_code,
              s.awb_number,
              s.label_printed_at,
              s.pick_completed_at,
              o.order_number,
              o.recipient_name,
              (SELECT COUNT(*) FROM shipment_items si WHERE si.shipment_id = s.id) AS item_count
         FROM shipments s
         JOIN order_shipments os ON os.shipment_id = s.id
         JOIN orders o ON o.id = os.order_id
        WHERE ${packEligibleSql('s', 'o')}
          ${PACK_UNCLAIMED_SQL('s')}
          ${courierCode === undefined ? '' : 'AND s.courier_code = $2'}
        ORDER BY s.created_at ASC
        LIMIT ${Math.max(1, Math.min(limit, 500))}`,
      ...(courierCode === undefined ? [staffId] : [staffId, courierCode]),
    );

    return rows.map((r) => ({
      shipmentId: r.id,
      shipmentNumber: r.shipment_number,
      courierCode: r.courier_code,
      awbNumber: r.awb_number,
      orderNumber: r.order_number,
      recipientName: r.recipient_name,
      labelPrintedAtIso: r.label_printed_at?.toISOString() ?? null,
      pickCompletedAtIso: r.pick_completed_at?.toISOString() ?? null,
      // `COUNT(*)` comes back as a bigint and JSON cannot carry one.
      itemCount: Number(r.item_count),
    }));
  }

  /**
   * Everything another packer is holding right now, with who and until
   * when. Read-only, never a claim of its own.
   *
   * Exactly the complement of `listWaiting`: the same eligibility, the
   * exclusions INVERTED, so the two lists together are every parcel
   * waiting to be packed and nothing is unaccounted for.
   */
  async listInProgress(staffId: string, courierCode?: string): Promise<PackInProgress[]> {
    const rows = await this.prisma.client.$queryRawUnsafe<
      Array<{
        id: string;
        shipment_number: string;
        awb_number: string | null;
        order_number: string | null;
        hold: string;
        held_by: string;
        held_by_name: string | null;
        held_until: Date;
      }>
    >(
      `SELECT s.id,
              s.shipment_number,
              s.awb_number,
              o.order_number,
              CASE WHEN pb.id IS NOT NULL THEN 'BOX' ELSE 'CLAIM' END AS hold,
              COALESCE(pb.packer_staff_id, s.pack_claimed_by_staff_id) AS held_by,
              COALESCE(bu.email_display, bu.email, cu.email_display, cu.email) AS held_by_name,
              COALESCE(pb.expires_at, s.pack_claim_expires_at) AS held_until
         FROM shipments s
         JOIN order_shipments os ON os.shipment_id = s.id
         JOIN orders o ON o.id = os.order_id
         LEFT JOIN pack_boxes pb
                ON pb.shipment_id = s.id
               AND pb.status = 'open'
               AND pb.expires_at > now()
               AND pb.packer_staff_id <> $1::uuid
         LEFT JOIN staff_users bu ON bu.id = pb.packer_staff_id
         LEFT JOIN staff_users cu ON cu.id = s.pack_claimed_by_staff_id
        WHERE ${packEligibleSql('s', 'o')}
          AND (
            pb.id IS NOT NULL
            OR (
              s.pack_claim_expires_at > now()
              AND s.pack_claimed_by_staff_id IS NOT NULL
              AND s.pack_claimed_by_staff_id <> $1::uuid
            )
          )
          ${courierCode === undefined ? '' : 'AND s.courier_code = $2'}
        ORDER BY s.created_at ASC
        LIMIT 100`,
      ...(courierCode === undefined ? [staffId] : [staffId, courierCode]),
    );

    return rows.map((r) => ({
      shipmentId: r.id,
      shipmentNumber: r.shipment_number,
      awbNumber: r.awb_number,
      orderNumber: r.order_number,
      hold: r.hold === 'BOX' ? 'BOX' : 'CLAIM',
      heldByStaffId: r.held_by,
      heldByName: r.held_by_name,
      heldUntilIso: r.held_until.toISOString(),
    }));
  }

  /**
   * Put a pulled parcel back, now rather than at the deadline.
   *
   * A packer who looks at what they pulled and cannot pack it (it is not
   * on the bench, the label is torn, it is somebody else's aisle) must
   * have a way to say so that does not cost the floor ten minutes.
   *
   * Guarded on the claim being THEIRS inside the writing statement: a
   * release can never take a parcel off the bench of the packer who
   * holds it, and releasing a claim that already lapsed is a no-op
   * rather than an error (the deadline did the work).
   */
  async releaseClaim(shipmentId: string, staffId: string): Promise<{ released: boolean }> {
    const res = await this.prisma.client.shipment.updateMany({
      where: { id: shipmentId, packClaimedByStaffId: staffId },
      data: { packClaimedByStaffId: null, packClaimExpiresAt: null },
    });
    return { released: res.count > 0 };
  }

  /**
   * Claim and return the next eligible parcel, or `null` (QUEUE_EMPTY).
   *
   * PACK-4: the claim is written by the SAME statement that selects the
   * row — `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT
   * 1)`. There is no window between deciding and claiming, so no
   * read-then-write: two simultaneous pulls skip each other's locked
   * rows, and two sequential pulls see the claim the first one left.
   *
   * `courierCode` restricts the pull to that courier only.
   */
  async pullNext(
    staffId: string,
    _ctx?: ClientContext,
    courierCode?: string,
  ): Promise<PulledPack | null> {
    const claimMinutes = await this.claimMinutes();
    const picked = await this.prisma.client.$transaction(async (tx) => {
      // Every caller-supplied value is a bound parameter, never
      // interpolated: $1 the asking packer, $2 the claim window, $3 the
      // optional courier. The fixed literals are enum values.
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE shipments s
            SET pack_claimed_by_staff_id = $1::uuid,
                pack_claim_expires_at = now() + make_interval(mins => $2::int)
          WHERE s.id = (
            SELECT s2.id
              FROM shipments s2
              JOIN order_shipments os ON os.shipment_id = s2.id
              JOIN orders o ON o.id = os.order_id
             WHERE ${packEligibleSql('s2', 'o')}
               ${PACK_UNCLAIMED_SQL('s2')}
               ${courierCode === undefined ? '' : 'AND s2.courier_code = $3'}
             ORDER BY s2.created_at ASC
             FOR UPDATE OF s2 SKIP LOCKED
             LIMIT 1
          )
          RETURNING s.id`,
        ...(courierCode === undefined
          ? [staffId, claimMinutes]
          : [staffId, claimMinutes, courierCode]),
      );
      const id = rows[0]?.id;
      if (id === undefined) return null;

      const shipment = await tx.shipment.findUnique({
        where: { id },
        select: {
          id: true,
          shipmentNumber: true,
          courierCode: true,
          pickCompletedAt: true,
          orderShipments: {
            select: { orderId: true },
            orderBy: { shipmentSequence: 'asc' },
            take: 1,
          },
          items: {
            select: {
              id: true,
              orderItemId: true,
              skuCode: true,
              productName: true,
              variantLabel: true,
              quantity: true,
              unitWeightGrams: true,
              pickedBinId: true,
              pickedBatchId: true,
              // R4 — shipment_items snapshots the SKU string, not the
              // variant id the mode resolves against. Same join the pick
              // gate walks.
              orderItem: {
                select: { variantId: true, order: { select: { sellerId: true } } },
              },
            },
          },
        },
      });
      if (!shipment) return null;
      return {
        shipmentId: shipment.id,
        shipmentNumber: shipment.shipmentNumber,
        orderId: shipment.orderShipments[0]?.orderId ?? null,
        courierCode: shipment.courierCode,
        pickCompletedAt: shipment.pickCompletedAt,
        sellerId: shipment.items[0]?.orderItem.order.sellerId ?? null,
        items: shipment.items.map((i) => ({
          shipmentItemId: i.id,
          orderItemId: i.orderItemId,
          variantId: i.orderItem.variantId,
          skuCode: i.skuCode,
          productName: i.productName,
          variantLabel: i.variantLabel,
          quantity: i.quantity,
          unitWeightGrams: i.unitWeightGrams,
          pickedBinId: i.pickedBinId,
          pickedBatchId: i.pickedBatchId,
        })),
      };
    });

    if (!picked) return null;

    // R4 — resolved outside the SKIP-LOCKED tx: a settings read must not
    // extend a lock the whole pack queue contends on.
    const items = await this.withModes(picked.sellerId, picked.items);

    if (picked.orderId === null) {
      this.logger.error(
        { shipmentId: picked.shipmentId },
        'Pulled pack shipment has no OrderShipment junction',
      );
      return {
        shipmentId: picked.shipmentId,
        shipmentNumber: picked.shipmentNumber,
        orderId: '',
        courierCode: picked.courierCode,
        pickCompletedAt: picked.pickCompletedAt,
        items,
        order: null,
      };
    }
    const order = await this.orders.getById(picked.orderId);
    if (!order) {
      this.logger.error(
        { shipmentId: picked.shipmentId, orderId: picked.orderId },
        'Pulled pack shipment references a missing/soft-deleted order',
      );
    }
    return {
      shipmentId: picked.shipmentId,
      shipmentNumber: picked.shipmentNumber,
      orderId: picked.orderId,
      courierCode: picked.courierCode,
      pickCompletedAt: picked.pickCompletedAt,
      items,
      order,
    };
  }

  /** Effective claim window (minutes): `ops.pack_claim_minutes`, else
   *  the default. Same shape as the box timeout and the pick timeout. */
  private async claimMinutes(): Promise<number> {
    try {
      const row = await this.prisma.client.systemSetting.findUnique({
        where: { key: CLAIM_SETTING },
        select: { valueInt: true },
      });
      const v = row?.valueInt;
      return typeof v === 'number' && v > 0 ? v : DEFAULT_CLAIM_MINUTES;
    } catch (err) {
      // A settings read failing must not stop the floor packing: the
      // default window is a worse number, not a blocked bench.
      this.logger.warn(
        { err: (err as Error).message },
        'Pack claim window unreadable; using the default (fail-open)',
      );
      return DEFAULT_CLAIM_MINUTES;
    }
  }

  /**
   * R4 — stamp each line with the mode the pack gate will enforce. ONE
   * batched resolve for the parcel, and FAIL-OPEN to NORMAL (UNIT-2): a
   * settings outage must leave the floor packing, not stall it behind a
   * scan field nobody can satisfy. `PackService.complete` re-resolves
   * and stays the authority; this is display only.
   */
  private async withModes(
    sellerId: string | null,
    items: readonly Omit<PulledPackItem, 'inventoryMode'>[],
  ): Promise<PulledPackItem[]> {
    const asNormal = (): PulledPackItem[] =>
      items.map((i) => ({ ...i, inventoryMode: InventoryMode.NORMAL }));
    if (sellerId === null) return asNormal();
    try {
      const modes = await this.modes.resolveForVariants(
        sellerId,
        items.map((i) => i.variantId),
      );
      return items.map((i) => ({
        ...i,
        inventoryMode: modes.get(i.variantId) ?? InventoryMode.NORMAL,
      }));
    } catch (err) {
      this.logger.warn(
        { sellerId, err: (err as Error).message },
        'Inventory-mode resolution failed on pack pull; reporting NORMAL (fail-open)',
      );
      return asNormal();
    }
  }
}
