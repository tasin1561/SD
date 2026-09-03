import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  OrderStatus,
  PackBoxStatus,
  Prisma,
  ShipmentStatus,
  StockUnitStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { ScanBlockService } from '../../system-issues/services/scan-block.service';

/**
 * The box on the pack bench.
 *
 * ── THE RITUAL ───────────────────────────────────────────────────────
 * A packer scans the shipping label to OPEN a box, scans every product
 * into it, then scans the label again to CLOSE. Closing is what packs
 * the parcel. The second label scan is not ceremony: it is the packer
 * asserting that the box in front of them is the box they opened, which
 * is the one thing a running count of scans cannot tell you.
 *
 * ── WHY A BOX AND NOT JUST A SUBMIT ──────────────────────────────────
 * Packing used to be one call: send the scans, the parcel completes.
 * With one packer that is fine. With ten working in parallel it is not
 * — two could pull the same parcel and only discover the collision at
 * the very end, with both boxes already filled. The OPEN box is an
 * exclusive claim taken UP FRONT, enforced by partial unique indexes
 * (`one open box per packer`, `one open box per shipment`) rather than
 * by a read-then-write check, because ten concurrent packers is exactly
 * the case a read-then-write check gets wrong.
 *
 * ── WHAT CANCELLING DOES, AND DOES NOT ───────────────────────────────
 * Cancelling discards the box: the scans go, any serialized units go
 * back to PICKED, and the parcel returns to the pack queue.
 *
 * It does NOT return anything to inventory, because packing never took
 * anything out of it. Stock leaves exactly once, at DISPATCH (CUR-3).
 * "Re-adding" the scanned goods would INFLATE on-hand by the size of
 * the box — the same class of error that inflated stock through the RTO
 * path once before, and which the conservation e2e now exists to catch.
 */

const EXPIRY_SETTING = 'ops.pack_box_timeout_minutes';
const DEFAULT_EXPIRY_MINUTES = 60;

export interface OpenBoxResult {
  packBoxId: string;
  shipmentId: string;
  orderId: string;
  awbNumber: string;
  expiresAt: Date;
  /** Lines the packer has to satisfy before the box can close. */
  expected: readonly {
    variantId: string;
    skuCode: string;
    productName: string;
    quantity: number;
  }[];
  alreadyOpen: boolean;
}

export interface ScanResult {
  packBoxId: string;
  variantId: string;
  skuCode: string;
  /** Set only for a serialized unit. */
  stockUnitId: string | null;
  scannedCount: number;
  expectedCount: number;
  complete: boolean;
}

@Injectable()
export class PackBoxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly scanBlock: ScanBlockService,
  ) {}

  /**
   * Open a box by scanning the shipping label.
   *
   * The AWB is the scan target because it is the only identifier that
   * exists on a physical label at the bench: the GST invoice is raised
   * at delivery, and the AWB itself is now generated at order
   * confirmation precisely so that it does.
   *
   * Re-scanning the same label while the packer already has that box
   * open is idempotent — a scanner that fires twice must not be an
   * error.
   */
  async open(awbNumber: string, staffId: string): Promise<OpenBoxResult> {
    // A packer stopped by a duplicate does not get to start another box.
    // The pile is what is in doubt, not just the one label.
    await this.scanBlock.assertNotBlocked(staffId);

    const code = awbNumber.trim();
    if (code.length === 0) {
      throw new ConflictException({
        code: 'PACK_SCAN_EMPTY',
        message: 'Scan the shipping label to open a box',
      });
    }

    const shipment = await this.prisma.client.shipment.findFirst({
      where: { awbNumber: code, deletedAt: null, supersededAt: null },
      select: {
        id: true,
        shipmentNumber: true,
        status: true,
        awbNumber: true,
        packCompletedAt: true,
        orderShipments: {
          select: { orderId: true, order: { select: { status: true } } },
          orderBy: { shipmentSequence: 'asc' },
          take: 1,
        },
        items: {
          select: { orderItemId: true, quantity: true, skuCode: true, productName: true },
        },
      },
    });

    if (!shipment) {
      throw new NotFoundException({
        code: 'PACK_AWB_NOT_FOUND',
        message: `No parcel found for ${code}`,
      });
    }

    const link = shipment.orderShipments[0];
    if (link === undefined) {
      throw new NotFoundException({
        code: 'ORDER_SHIPMENT_MISSING',
        message: `Parcel ${shipment.id} is not linked to an order`,
      });
    }

    // Already open FOR THIS PACKER → return it. Open for someone else →
    // say who, because "it is on another bench" is the useful answer.
    const existing = await this.prisma.client.packBox.findFirst({
      where: { shipmentId: shipment.id, status: PackBoxStatus.OPEN },
      select: { id: true, packerStaffId: true, expiresAt: true },
    });
    if (existing) {
      if (existing.packerStaffId === staffId) {
        return this.describeOpenBox(existing.id, true);
      }
      throw new ConflictException({
        code: 'PACK_BOX_HELD_BY_OTHER',
        message: 'This parcel is already open on another packer’s bench',
      });
    }

    // ALREADY PACKED is the duplicate this stop exists for: a label
    // being scanned to open a box for a parcel that was boxed and
    // sealed already. Either the label was printed twice, or this pile
    // has been done. Everything else here is a parcel that is simply
    // not ready, which is an ordinary refusal.
    if (shipment.packCompletedAt !== null) {
      await this.scanBlock.refuseDuplicate({
        flow: 'PACK',
        staffId,
        shipmentId: shipment.id,
        shipmentNumber: shipment.shipmentNumber,
        awbNumber: code,
        observed: 'packed',
      });
    }
    if (shipment.status !== ShipmentStatus.CREATED) {
      throw new ConflictException({
        code: 'PACK_NOT_AVAILABLE',
        message: `Parcel is ${shipment.status}`,
      });
    }
    if (link.order.status !== OrderStatus.PICKED) {
      throw new ConflictException({
        code: 'ORDER_NOT_PACKABLE',
        message: `Order is ${link.order.status}; a box can only be opened once the order is PICKED`,
      });
    }

    const minutes = await this.expiryMinutes();
    const expiresAt = new Date(Date.now() + minutes * 60_000);

    let boxId: string;
    try {
      // PACK-3: the box row and the shipment's pack_started_at projection
      // are ONE transaction. Written separately, a crash between them
      // leaves a parcel that the queue thinks nobody is packing while a
      // box is open on a bench — or the reverse, which is worse: a
      // parcel that looks claimed with no box to close.
      const created = await this.prisma.client.$transaction(async (tx) => {
        const box = await tx.packBox.create({
          data: {
            shipmentId: shipment.id,
            orderId: link.orderId,
            packerStaffId: staffId,
            openedWithCode: code,
            expiresAt,
          },
          select: { id: true, openedAt: true },
        });
        // Guarded on NULL so it records when packing FIRST began. A
        // second box on the same parcel, or a re-open after a cancel,
        // must not restate the start time — "how long has this been on
        // the bench" is the question the column answers.
        await tx.shipment.updateMany({
          where: { id: shipment.id, packStartedAt: null },
          data: { packStartedAt: box.openedAt },
        });
        return box;
      });
      boxId = created.id;
    } catch (err) {
      // The partial unique indexes are the real guard, not the checks
      // above: two packers scanning the same label in the same instant
      // both pass those checks and one loses here. Same for a packer
      // who already has a box open on another bench.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = String(err.meta?.['target'] ?? '');
        throw new ConflictException(
          target.includes('packer')
            ? {
                code: 'PACK_BOX_ALREADY_OPEN',
                message: 'Close or cancel your open box before starting another',
              }
            : {
                code: 'PACK_BOX_HELD_BY_OTHER',
                message: 'This parcel is already open on another packer’s bench',
              },
        );
      }
      throw err;
    }

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'pack_box.opened',
      entityType: 'pack_box',
      entityId: boxId,
      severity: 'LOW',
      metadata: { shipmentId: shipment.id, orderId: link.orderId, awbNumber: code },
    });

    return this.describeOpenBox(boxId, false);
  }

  /**
   * Scan one product into the open box.
   *
   * A code can be either a per-unit serial (a serialized, STRICT-mode
   * product) or a SKU barcode (an ordinary one). Serials are resolved
   * first, because a serial is the more specific claim and is what
   * links THIS physical unit to THIS order — which is the whole point
   * of serializing.
   *
   * Over-scanning is refused at the point of scan rather than at close:
   * telling a packer "that is one too many" while the item is still in
   * their hand is worth far more than telling them at the end that the
   * box is wrong.
   */
  async scan(packBoxId: string, rawCode: string, staffId: string): Promise<ScanResult> {
    const code = rawCode.trim();
    if (code.length === 0) {
      throw new ConflictException({ code: 'PACK_SCAN_EMPTY', message: 'Nothing was scanned' });
    }

    const box = await this.requireOpenBox(packBoxId, staffId);

    // A serial identifies one unit; a barcode identifies a SKU. Try the
    // specific one first.
    const unit = await this.prisma.client.stockUnit.findFirst({
      where: { serialBarcode: code, status: StockUnitStatus.PICKED },
      select: { id: true, variantId: true, shipmentItemId: true },
    });

    let variantId: string;
    let stockUnitId: string | null = null;

    if (unit !== null) {
      // The unit must belong to THIS parcel. A unit picked for another
      // order landing in this box is precisely the mix-up the scan gate
      // exists to catch.
      const belongs =
        unit.shipmentItemId !== null &&
        (await this.prisma.client.shipmentItem.count({
          where: { id: unit.shipmentItemId, shipmentId: box.shipmentId },
        })) > 0;
      if (!belongs) {
        throw new ConflictException({
          code: 'PACK_UNIT_WRONG_PARCEL',
          message: 'That unit was picked for a different parcel',
        });
      }
      variantId = unit.variantId;
      stockUnitId = unit.id;
    } else {
      // A SKU-level code: the seller's own barcode when they have one,
      // and otherwise the SKU CODE itself, because that is what our
      // label sheet prints for a product with no manufacturer barcode
      // (SkuLabelService.scannableCodeFor). Accepting both means a
      // sticker printed today keeps scanning after the seller fills in
      // a real EAN — the alternative was minting a code and saving it,
      // which silently invalidates every sticker already on a shelf the
      // day the real one arrives.
      //
      // Scoped to THIS order's seller: `barcode` carries no uniqueness
      // constraint and `skuCode` is unique only per seller, so an
      // unscoped lookup can resolve another seller's product. It failed
      // closed before (the variant would not be on this order), but
      // failing closed on the wrong reason tells a packer "not on this
      // order" when the truth is "that is somebody else's SKU".
      const sellerId = await this.sellerIdForShipment(box.shipmentId);
      const variant = await this.prisma.client.productVariant.findFirst({
        where: {
          sellerId,
          deletedAt: null,
          OR: [{ barcode: code }, { skuCode: code }],
        },
        select: { id: true },
      });
      if (variant === null) {
        throw new NotFoundException({
          code: 'PACK_CODE_UNKNOWN',
          message: `Nothing matches ${code}`,
        });
      }
      variantId = variant.id;
    }

    const expected = await this.expectedByVariant(box.shipmentId);
    const wanted = expected.get(variantId);
    if (wanted === undefined) {
      throw new ConflictException({
        code: 'PACK_PRODUCT_NOT_IN_ORDER',
        message: 'That product is not on this order',
      });
    }

    const already = await this.prisma.client.packBoxScan.count({ where: { packBoxId, variantId } });
    if (already >= wanted.quantity) {
      throw new ConflictException({
        code: 'PACK_QUANTITY_EXCEEDED',
        message: `The order needs ${wanted.quantity} × ${wanted.skuCode}; that is one too many`,
      });
    }
    if (stockUnitId !== null) {
      const dupe = await this.prisma.client.packBoxScan.count({
        where: { packBoxId, stockUnitId },
      });
      if (dupe > 0) {
        throw new ConflictException({
          code: 'PACK_UNIT_ALREADY_SCANNED',
          message: 'That exact unit is already in the box',
        });
      }
    }

    await this.prisma.client.packBoxScan.create({
      data: { packBoxId, variantId, stockUnitId, scannedCode: code },
    });

    const scannedCount = await this.prisma.client.packBoxScan.count({ where: { packBoxId } });
    const expectedCount = [...expected.values()].reduce((n, r) => n + r.quantity, 0);

    return {
      packBoxId,
      variantId,
      skuCode: wanted.skuCode,
      stockUnitId,
      scannedCount,
      expectedCount,
      complete: scannedCount === expectedCount,
    };
  }

  /**
   * Close the box by scanning the label again.
   *
   * The second label scan is the packer asserting that the box in front
   * of them is the one they opened — the one thing a running count
   * cannot tell you. A mismatch here means two boxes got swapped on the
   * bench, which is exactly the mistake worth catching.
   *
   * The contents are checked as a SET, per variant and per unit. A count
   * alone would happily pass a box holding two of one product and none
   * of another.
   */
  async close(
    packBoxId: string,
    scannedCode: string,
    staffId: string,
  ): Promise<{ packBoxId: string; shipmentId: string; orderId: string; scannedCount: number }> {
    const box = await this.requireOpenBox(packBoxId, staffId);

    if (scannedCode.trim() !== box.openedWithCode) {
      throw new ConflictException({
        code: 'PACK_LABEL_MISMATCH',
        message: 'That is a different parcel’s label — scan the label this box was opened with',
      });
    }

    const expected = await this.expectedByVariant(box.shipmentId);
    const scans = await this.prisma.client.packBoxScan.groupBy({
      by: ['variantId'],
      where: { packBoxId },
      _count: { _all: true },
    });
    const scannedByVariant = new Map(scans.map((r) => [r.variantId, r._count._all]));

    const short: string[] = [];
    for (const [variantId, want] of expected) {
      const got = scannedByVariant.get(variantId) ?? 0;
      if (got !== want.quantity) {
        short.push(`${want.skuCode}: ${got} of ${want.quantity}`);
      }
    }
    for (const variantId of scannedByVariant.keys()) {
      if (!expected.has(variantId)) short.push('an item that is not on this order');
    }
    if (short.length > 0) {
      throw new ConflictException({
        code: 'PACK_CONTENTS_MISMATCH',
        message: `The box does not match the order — ${short.join('; ')}`,
      });
    }

    const scannedCount = await this.prisma.client.packBoxScan.count({ where: { packBoxId } });

    // Guarded claim: whoever closes first wins, and a double-submit is
    // a clean no-op rather than a second pack.
    const closed = await this.prisma.client.packBox.updateMany({
      where: { id: packBoxId, status: PackBoxStatus.OPEN },
      data: { status: PackBoxStatus.CLOSED, closedAt: new Date() },
    });
    if (closed.count === 0) {
      throw new ConflictException({
        code: 'PACK_BOX_ALREADY_MOVED',
        message: 'This box was already closed or cancelled',
      });
    }

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'pack_box.closed',
      entityType: 'pack_box',
      entityId: packBoxId,
      severity: 'LOW',
      metadata: { shipmentId: box.shipmentId, orderId: box.orderId, scannedCount },
    });

    return { packBoxId, shipmentId: box.shipmentId, orderId: box.orderId, scannedCount };
  }

  /**
   * Abandon an open box.
   *
   * The scans are discarded and any serialized units go back to PICKED —
   * they are still on the bench, just no longer claimed by this box. The
   * parcel returns to the pack queue.
   *
   * Nothing is returned to inventory. Packing never took anything out of
   * it; stock leaves exactly once, at DISPATCH.
   */
  async cancel(
    packBoxId: string,
    reason: string,
    staffId: string,
  ): Promise<{ packBoxId: string; releasedScans: number }> {
    const box = await this.requireOpenBox(packBoxId, staffId);
    const releasedScans = await this.prisma.client.packBoxScan.count({ where: { packBoxId } });

    const claimed = await this.prisma.client.packBox.updateMany({
      where: { id: packBoxId, status: PackBoxStatus.OPEN },
      data: { status: PackBoxStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason },
    });
    if (claimed.count === 0) {
      throw new ConflictException({
        code: 'PACK_BOX_ALREADY_MOVED',
        message: 'This box was already closed or cancelled',
      });
    }
    await this.releaseScans(packBoxId);

    await this.clearPackStartedIfIdle(box.shipmentId);

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'pack_box.cancelled',
      entityType: 'pack_box',
      entityId: packBoxId,
      severity: 'MEDIUM',
      metadata: { shipmentId: box.shipmentId, orderId: box.orderId, releasedScans, reason },
    });

    return { packBoxId, releasedScans };
  }

  /** The box, if it is open AND belongs to this packer. */
  private async requireOpenBox(
    packBoxId: string,
    staffId: string,
  ): Promise<{ shipmentId: string; orderId: string; openedWithCode: string }> {
    const box = await this.prisma.client.packBox.findUnique({
      where: { id: packBoxId },
      select: {
        status: true,
        packerStaffId: true,
        shipmentId: true,
        orderId: true,
        openedWithCode: true,
      },
    });
    if (box === null) {
      throw new NotFoundException({ code: 'PACK_BOX_NOT_FOUND', message: 'No such box' });
    }
    if (box.status !== PackBoxStatus.OPEN) {
      throw new ConflictException({
        code: 'PACK_BOX_NOT_OPEN',
        message: `This box is ${box.status.toLowerCase()}`,
      });
    }
    if (box.packerStaffId !== staffId) {
      throw new ConflictException({
        code: 'PACK_BOX_HELD_BY_OTHER',
        message: 'This box is open on another packer’s bench',
      });
    }
    return { shipmentId: box.shipmentId, orderId: box.orderId, openedWithCode: box.openedWithCode };
  }

  /** What the parcel owes, per variant — the snapshot, aggregated. */
  /** Whose goods are in this box — the scope for a SKU-code lookup. */
  private async sellerIdForShipment(shipmentId: string): Promise<string> {
    const link = await this.prisma.client.orderShipment.findFirst({
      where: { shipmentId },
      orderBy: { shipmentSequence: 'asc' },
      select: { order: { select: { sellerId: true } } },
    });
    if (link === null) {
      throw new NotFoundException({
        code: 'PACK_ORDER_MISSING',
        message: 'This parcel is not linked to an order',
      });
    }
    return link.order.sellerId;
  }

  private async expectedByVariant(
    shipmentId: string,
  ): Promise<Map<string, { skuCode: string; quantity: number }>> {
    const items = await this.prisma.client.shipmentItem.findMany({
      where: { shipmentId },
      select: { skuCode: true, quantity: true },
    });
    const bySku = new Map<string, number>();
    for (const i of items) bySku.set(i.skuCode, (bySku.get(i.skuCode) ?? 0) + i.quantity);

    const variants = await this.prisma.client.productVariant.findMany({
      where: { skuCode: { in: [...bySku.keys()] } },
      select: { id: true, skuCode: true },
    });
    return new Map(
      variants.map((v) => [v.id, { skuCode: v.skuCode, quantity: bySku.get(v.skuCode) ?? 0 }]),
    );
  }

  /** The box as the bench needs to see it: what is expected, what is in. */
  private async describeOpenBox(packBoxId: string, alreadyOpen: boolean): Promise<OpenBoxResult> {
    const box = await this.prisma.client.packBox.findUniqueOrThrow({
      where: { id: packBoxId },
      select: {
        id: true,
        shipmentId: true,
        orderId: true,
        expiresAt: true,
        shipment: {
          select: {
            awbNumber: true,
            items: { select: { skuCode: true, productName: true, quantity: true } },
          },
        },
      },
    });

    // Expected lines are the parcel's own snapshot, aggregated by SKU —
    // the shipment_items rows are per order line, and two lines of the
    // same SKU are one thing to count at the bench.
    const bySku = new Map<string, { skuCode: string; productName: string; quantity: number }>();
    for (const item of box.shipment.items) {
      const row = bySku.get(item.skuCode);
      if (row) row.quantity += item.quantity;
      else
        bySku.set(item.skuCode, {
          skuCode: item.skuCode,
          productName: item.productName,
          quantity: item.quantity,
        });
    }

    const variants = await this.prisma.client.productVariant.findMany({
      where: { skuCode: { in: [...bySku.keys()] } },
      select: { id: true, skuCode: true },
    });
    const variantBySku = new Map(variants.map((v) => [v.skuCode, v.id]));

    return {
      packBoxId: box.id,
      shipmentId: box.shipmentId,
      orderId: box.orderId,
      awbNumber: box.shipment.awbNumber ?? '',
      expiresAt: box.expiresAt,
      expected: [...bySku.values()].map((r) => ({
        variantId: variantBySku.get(r.skuCode) ?? '',
        skuCode: r.skuCode,
        productName: r.productName,
        quantity: r.quantity,
      })),
      alreadyOpen,
    };
  }

  /** Effective box timeout (minutes): ops.pack_box_timeout_minutes,
   *  else the default. Same shape as the pick-task timeout. */
  private async expiryMinutes(): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: EXPIRY_SETTING },
      select: { valueInt: true },
    });
    const v = row?.valueInt;
    return typeof v === 'number' && v > 0 ? v : DEFAULT_EXPIRY_MINUTES;
  }

  /**
   * Expire boxes left open past their deadline.
   *
   * Time-based and idempotent, the same shape as the pick claim (WMS-5):
   * a guarded `updateMany` on `(status = OPEN, expiresAt < now)` so a
   * retry, a duplicate timer, or a box closed a moment ago can never be
   * double-expired. Scans are released with the box, exactly as a
   * cancel does — and for the same reason, nothing goes back to
   * inventory, because nothing left it.
   *
   * Public: it doubles as the supervisor's manual sweep.
   */
  async expireOverdue(): Promise<{ expired: number }> {
    const now = new Date();
    const overdue = await this.prisma.client.packBox.findMany({
      where: { status: PackBoxStatus.OPEN, expiresAt: { lt: now } },
      select: { id: true, shipmentId: true, packerStaffId: true },
    });
    if (overdue.length === 0) return { expired: 0 };

    let expired = 0;
    for (const box of overdue) {
      const claimed = await this.prisma.client.packBox.updateMany({
        where: { id: box.id, status: PackBoxStatus.OPEN },
        data: { status: PackBoxStatus.EXPIRED },
      });
      if (claimed.count === 0) continue; // someone closed it first
      await this.releaseScans(box.id);
      // PACK-3: an abandoned box leaves the parcel unpacked, so the
      // projection must stop claiming somebody is on it. Same rule as
      // cancel — only when no live box remains.
      await this.clearPackStartedIfIdle(box.shipmentId);
      expired += 1;
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        actorId: null,
        action: 'pack_box.expired',
        entityType: 'pack_box',
        entityId: box.id,
        severity: 'MEDIUM',
        metadata: { shipmentId: box.shipmentId, packerStaffId: box.packerStaffId },
      });
    }
    return { expired };
  }

  /**
   * Stop claiming a parcel is being packed once no live box remains.
   *
   * PACK-3: `pack_boxes` is the fact and `shipments.pack_started_at` is
   * a projection of it, so the projection has to be able to go back to
   * null. Leaving it set after the last box is cancelled or expires
   * would show the parcel as being packed by nobody, and the floor
   * report would age it forever.
   *
   * Conditional rather than unconditional because a parcel may
   * legitimately have several boxes; one being abandoned does not mean
   * packing stopped. CLOSED counts as live — the work happened.
   */
  private async clearPackStartedIfIdle(shipmentId: string): Promise<void> {
    const stillLive = await this.prisma.client.packBox.count({
      where: {
        shipmentId,
        status: { in: [PackBoxStatus.OPEN, PackBoxStatus.CLOSED] },
      },
    });
    if (stillLive > 0) return;
    await this.prisma.client.shipment.updateMany({
      where: { id: shipmentId },
      data: { packStartedAt: null },
    });
  }

  /**
   * Undo a box's scans.
   *
   * Serialized units go back to PICKED — they are still physically on
   * the bench, they are simply no longer claimed by this box. The scan
   * rows are deleted with the box's cascade.
   *
   * Nothing is returned to inventory. See the note at the top of this
   * file: packing never removed it.
   */
  private async releaseScans(packBoxId: string): Promise<void> {
    const scans = await this.prisma.client.packBoxScan.findMany({
      where: { packBoxId, stockUnitId: { not: null } },
      select: { stockUnitId: true },
    });
    const unitIds = scans.map((s) => s.stockUnitId).filter((id): id is string => id !== null);
    if (unitIds.length > 0) {
      await this.prisma.client.stockUnit.updateMany({
        where: { id: { in: unitIds }, status: StockUnitStatus.PACKED },
        data: { status: StockUnitStatus.PICKED },
      });
    }
    await this.prisma.client.packBoxScan.deleteMany({ where: { packBoxId } });
  }
}
