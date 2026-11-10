import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';

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
 * ── THE DEADLINE SLIDES (2026-11-10, owner) ──────────────────────────
 * `expires_at` is ten minutes of IDLE, pushed forward by every accepted
 * scan in the same write that records it. The sweep (`expireOverdue`)
 * therefore only ever catches a bench nobody is standing at, and a packer
 * working a twenty-line order is never cut off mid-box.
 *
 * It does NOT return anything to inventory, because packing never took
 * anything out of it. Stock leaves exactly once, at DISPATCH (CUR-3).
 * "Re-adding" the scanned goods would INFLATE on-hand by the size of
 * the box — the same class of error that inflated stock through the RTO
 * path once before, and which the conservation e2e now exists to catch.
 */

const EXPIRY_SETTING = 'ops.pack_box_timeout_minutes';
/**
 * How long a box may sit with NOBODY SCANNING INTO IT (owner, 2026-11-10:
 * ten minutes — "someone was packing and suddenly he went somewhere and
 * kept the box open").
 *
 * It is ten minutes of IDLE, not of work. The deadline slides forward on
 * every accepted scan (`scan`), which is the whole reason ten is a safe
 * number: as a TOTAL budget it would expire a twenty-line order under the
 * packer at minute ten, mid-scan, losing every scan in the box and handing
 * the parcel to somebody else while they stood over it. Measured from the
 * last scan, it only ever catches a bench nobody is at.
 */
const DEFAULT_EXPIRY_MINUTES = 10;

/**
 * A colleague's name for a bench refusal — NEVER a uuid, never an email
 * (2026-11-10, owner: "for whom this blunder has appeared … so that they
 * can easily fix this between them").
 *
 * ── THE SCHEMA GAP THIS WORKS AROUND ─────────────────────────────────
 * `staff_users` has no name column: `email` and `email_display` are the
 * only identifying strings on the row. So the handle is the local part,
 * with separators opened out and words capitalised —
 * `rahim.ali@skydrop.global` → "Rahim Ali". It is not an address (no
 * domain, never printable as one) and it is what colleagues call each
 * other on a floor.
 *
 * **The real fix is a `staff_users.full_name` column**, which is a
 * migration and therefore not this change's to make. Until it exists this
 * is the most actionable string available, and the alternative — a uuid,
 * or no name at all — is the thing the owner asked us to stop doing.
 *
 * Returns null rather than a blank or a placeholder when there is nothing
 * usable (a SYSTEM actor, a deleted user, an address with an empty local
 * part): the copy then drops the clause instead of saying "held by
 * undefined".
 */
export function staffName(emailDisplay: string | null | undefined): string | null {
  const local = (emailDisplay ?? '').split('@')[0]?.trim() ?? '';
  if (local === '') return null;
  const words = local
    .split(/[._+-]+/)
    .map((w) => w.trim())
    .filter((w) => w !== '')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.length === 0 ? null : words.join(' ');
}

/**
 * A wall-clock time for the floor, in the warehouse's own zone.
 *
 * A CLOCK TIME, not "in 23 minutes" (owner): the dialog is read again
 * five minutes later, and a relative figure is wrong by then while
 * "11:05" is still true. 24-hour and Western numerals, like every other
 * figure the bench shows.
 */
export function clockTime(at: Date | null | undefined): string | null {
  if (at === null || at === undefined) return null;
  const ms = at.getTime();
  if (Number.isNaN(ms)) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

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
    /**
     * The product's picture, as a read-time presigned thumbnail URL from
     * `CatalogReadService` — carried so the bench can show the packer what
     * the thing LOOKS like. The pack bench is worked by people who may not
     * read the name beside it, so the picture is the primary way a line is
     * matched to the item in hand. `null` when the seller never uploaded
     * one, or when the thumbnail service was unavailable; the bench draws a
     * neutral placeholder rather than a broken frame.
     */
    imageUrl: string | null;
  }[];
  alreadyOpen: boolean;
}

export interface ScanResult {
  packBoxId: string;
  variantId: string;
  skuCode: string;
  /** Set only for a serialized unit. */
  stockUnitId: string | null;
  /**
   * The box's LIVE deadline, pushed forward by this very scan. The bench
   * shows it, so it has to come back from every scan — a deadline drawn
   * from the open call is wrong the moment the first item goes in.
   */
  expiresAt: Date;
  scannedCount: number;
  expectedCount: number;
  complete: boolean;
}

@Injectable()
export class PackBoxService {
  private readonly logger = new Logger(PackBoxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly scanBlock: ScanBlockService,
    private readonly catalog: CatalogReadService,
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
        // WHO got there first, for a refusal two colleagues have to sort
        // out between themselves. Same query — no added cost.
        packedBy: { select: { emailDisplay: true } },
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
      // A SUPERSEDED label is not an unknown one (2026-11-10, handed over
      // by the concurrency work). The lookup above excludes it on purpose
      // — the parcel now travels under a new AWB — but "No parcel found"
      // reads to an amateur as a broken scanner, and the pile of old
      // stickers then gets re-scanned one by one. Say that the label was
      // replaced, and name the one that did it.
      //
      // One query, only on this already-failing path.
      const replaced = await this.prisma.client.shipment.findFirst({
        where: { awbNumber: code, deletedAt: null, supersededAt: { not: null } },
        select: {
          shipmentNumber: true,
          supersededBy: {
            where: { deletedAt: null },
            select: { awbNumber: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
      if (replaced !== null) {
        const fresh = replaced.supersededBy[0]?.awbNumber ?? null;
        throw new ConflictException({
          code: 'PACK_LABEL_SUPERSEDED',
          message: `Label ${code} was replaced and a new one printed for parcel ${replaced.shipmentNumber}. Bin this sticker and scan the new label${
            fresh === null ? '' : `, ${fresh}`
          }.`,
          details: { otherAwb: code, ...(fresh === null ? {} : { awb: fresh }) },
        });
      }
      throw new NotFoundException({
        code: 'PACK_AWB_NOT_FOUND',
        message: `No parcel found for ${code}`,
      });
    }

    const link = shipment.orderShipments[0];
    if (link === undefined) {
      // The parcel's NUMBER and label, never its uuid: the packer is
      // holding a sticker, and a uuid is not on it.
      throw new NotFoundException({
        code: 'ORDER_SHIPMENT_MISSING',
        message: `Parcel ${shipment.shipmentNumber} (${code}) is not linked to an order. Put it aside and call your supervisor.`,
        details: { awb: code },
      });
    }

    // Already open FOR THIS PACKER → return it. Open for someone else →
    // say who, because "it is on another bench" is the useful answer.
    const existing = await this.prisma.client.packBox.findFirst({
      where: { shipmentId: shipment.id, status: PackBoxStatus.OPEN },
      select: {
        id: true,
        packerStaffId: true,
        expiresAt: true,
        packer: { select: { emailDisplay: true } },
      },
    });
    if (existing) {
      if (existing.packerStaffId === staffId) {
        return this.describeOpenBox(existing.id, true);
      }
      throw new ConflictException(
        this.heldByOther(code, existing.packer.emailDisplay, existing.expiresAt),
      );
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
      const who = staffName(shipment.packedBy?.emailDisplay ?? null);
      throw new ConflictException({
        code: 'PACK_NOT_AVAILABLE',
        message: `Parcel ${code} is ${shipment.status.toLowerCase().replace(/_/g, ' ')}, so it cannot be packed.${
          who === null ? '' : ` ${who} already took it this far.`
        } Put it aside and take the next parcel.`,
        details: {
          awb: code,
          ...(who === null ? {} : { who }),
          ...(shipment.packCompletedAt === null
            ? {}
            : { when: clockTime(shipment.packCompletedAt) }),
        },
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
        if (target.includes('packer')) {
          // NAME the box they already have. "Close or cancel your open
          // box" is only actionable if the packer can find it, and on a
          // bench with four parcels on it they cannot.
          const mine = await this.prisma.client.packBox.findFirst({
            where: { packerStaffId: staffId, status: PackBoxStatus.OPEN },
            select: { expiresAt: true, shipment: { select: { awbNumber: true } } },
          });
          const openAwb = mine?.shipment.awbNumber ?? null;
          throw new ConflictException({
            code: 'PACK_BOX_ALREADY_OPEN',
            message:
              openAwb === null
                ? 'Close or cancel your open box before starting another'
                : `You already have parcel ${openAwb} open. Finish or cancel that box before starting another.`,
            details: {
              ...(openAwb === null ? {} : { awb: openAwb }),
              ...(mine === null ? {} : { when: clockTime(mine.expiresAt) }),
            },
          });
        }
        // The loser of the race gets the same four facts as the
        // ordinary refusal above: one extra read, on a path that has
        // already failed.
        const holder = await this.prisma.client.packBox.findFirst({
          where: { shipmentId: shipment.id, status: PackBoxStatus.OPEN },
          select: { expiresAt: true, packer: { select: { emailDisplay: true } } },
        });
        throw new ConflictException(
          this.heldByOther(code, holder?.packer.emailDisplay ?? null, holder?.expiresAt ?? null),
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
    /** The SKU the code resolved to, for naming it in a refusal. */
    let scannedSku: string | null = null;

    if (unit !== null) {
      // The unit must belong to THIS parcel. A unit picked for another
      // order landing in this box is precisely the mix-up the scan gate
      // exists to catch.
      //
      // The home parcel is READ rather than counted so the refusal can
      // name BOTH parcels — the one the piece belongs to and the one the
      // packer is filling. Same single query either way; "a different
      // parcel" with no name left the packer holding a piece and nowhere
      // to put it.
      const home =
        unit.shipmentItemId === null
          ? null
          : await this.prisma.client.shipmentItem.findUnique({
              where: { id: unit.shipmentItemId },
              select: { shipmentId: true, shipment: { select: { awbNumber: true } } },
            });
      if (home === null || home.shipmentId !== box.shipmentId) {
        throw new ConflictException(
          this.wrongParcelUnit(box.openedWithCode, home?.shipment.awbNumber ?? null),
        );
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
        select: { id: true, skuCode: true },
      });
      if (variant === null) {
        // Nothing of this client's matched — so NAME the mistake instead
        // of calling every one of them an unknown barcode. See
        // `unresolvedCodeRefusal`: at most three more queries, all of them
        // on a path that is already refusing.
        throw await this.unresolvedCodeRefusal(code, box, sellerId);
      }
      variantId = variant.id;
      scannedSku = variant.skuCode;
    }

    const expected = await this.expectedByVariant(box.shipmentId);
    const wanted = expected.get(variantId);
    if (wanted === undefined) {
      // It IS this client's product, it is simply not on this parcel. Name
      // it: the packer is holding something and "not on this order" does
      // not tell them WHICH of the things in their hands is wrong.
      const named = scannedSku ?? code;
      throw new ConflictException({
        code: 'PACK_PRODUCT_NOT_IN_ORDER',
        message: `${named} is not on parcel ${box.openedWithCode}. Put it aside; scan only what the screen lists.`,
        details: { awb: box.openedWithCode, item: named },
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

    // ONE write: the scan row and the box's sliding deadline together, as
    // a nested create. Never a read of expires_at followed by a write of
    // it — ten packers scanning at once would each be writing a value they
    // read before the others moved it.
    const minutes = await this.expiryMinutes();
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    await this.prisma.client.packBox.update({
      where: { id: packBoxId },
      data: {
        expiresAt,
        scans: { create: { variantId, stockUnitId, scannedCode: code } },
      },
      select: { id: true },
    });

    const scannedCount = await this.prisma.client.packBoxScan.count({ where: { packBoxId } });
    const expectedCount = [...expected.values()].reduce((n, r) => n + r.quantity, 0);

    return {
      packBoxId,
      variantId,
      skuCode: wanted.skuCode,
      stockUnitId,
      expiresAt,
      scannedCount,
      expectedCount,
      complete: scannedCount === expectedCount,
    };
  }

  /**
   * The box is not open any more — and WHICH of the three reasons it is.
   *
   * The one that matters is EXPIRED, because of who is reading it: a
   * packer who stepped away, came back, and scanned the next item into a
   * box that is no longer there (owner, 2026-11-10). "This box is expired"
   * is true and tells them nothing; what they need to know is that the
   * parcel went back to the queue and nothing was lost — or, if somebody
   * has since packed it, that it is finished and by whom.
   *
   * Only the EXPIRED branch costs a query, and only on a refusal.
   */
  private async boxNoLongerOpen(box: {
    status: PackBoxStatus;
    shipmentId: string;
    openedWithCode: string;
  }): Promise<ConflictException> {
    if (box.status !== PackBoxStatus.EXPIRED) {
      return new ConflictException({
        code: 'PACK_BOX_NOT_OPEN',
        message: `This box is ${box.status.toLowerCase()}, so nothing more can go in it. Scan the shipping label again to start over.`,
        details: { awb: box.openedWithCode },
      });
    }

    const parcel = await this.prisma.client.shipment.findUnique({
      where: { id: box.shipmentId },
      select: { packCompletedAt: true, packedBy: { select: { emailDisplay: true } } },
    });
    if (parcel?.packCompletedAt != null) {
      const who = staffName(parcel.packedBy?.emailDisplay ?? null);
      const when = clockTime(parcel.packCompletedAt);
      return new ConflictException({
        code: 'PACK_PARCEL_PACKED_BY_OTHER',
        message: `While this box stood open, parcel ${box.openedWithCode} was packed by ${
          who ?? 'somebody else'
        }${when === null ? '' : ` at ${when}`}. Nothing was lost — the parcel is done. Take the next one.`,
        details: {
          awb: box.openedWithCode,
          ...(who === null ? {} : { who }),
          ...(when === null ? {} : { when }),
        },
      });
    }
    return new ConflictException({
      code: 'PACK_BOX_EXPIRED',
      message: `This box was left open too long, so parcel ${box.openedWithCode} went back to the queue. Scan its label again to start over; nothing was packed and nothing was lost.`,
      details: { awb: box.openedWithCode },
    });
  }

  /**
   * "Somebody else has this parcel open" — with WHO and WHEN.
   *
   * The commonest refusal on a floor with four benches is not a mistake
   * at all: two people reached for the same parcel and the first one kept
   * it. What the second needs is the colleague's name and the time the
   * claim lapses, because those are what let the two of them settle it
   * without a supervisor — which is exactly what the owner asked for.
   *
   * Degrades cleanly: an unnameable holder (SYSTEM, a deleted user) or a
   * missing expiry simply drops its clause. Never "held by undefined".
   */
  private heldByOther(
    awb: string,
    holderEmail: string | null,
    expiresAt: Date | null,
  ): { code: string; message: string; details: Record<string, string> } {
    const who = staffName(holderEmail);
    const when = clockTime(expiresAt);
    const holder = who === null ? 'Another packer' : who;
    const frees = when === null ? '' : ` If they do not, the box frees itself at ${when}.`;
    return {
      code: 'PACK_BOX_HELD_BY_OTHER',
      message: `${holder} has parcel ${awb} open. Ask them to close or cancel that box, then take the next parcel.${frees}`,
      details: {
        awb,
        ...(who === null ? {} : { who }),
        ...(when === null ? {} : { when }),
      },
    };
  }

  /**
   * The refusal for a serialised piece that is not this box's.
   *
   * Shared by the two places that can tell: the ordinary PICKED lookup in
   * `scan`, and the failure-path diagnosis below. It names the parcel the
   * piece was picked for when we know it, and ALWAYS names the box the
   * packer has open — "a different parcel" on its own leaves somebody
   * holding a piece with nowhere to put it and nothing to scan next.
   */
  private wrongParcelUnit(
    openAwb: string,
    otherAwb: string | null,
  ): { code: string; message: string; details: Record<string, string> } {
    return {
      code: 'PACK_UNIT_WRONG_PARCEL',
      message:
        otherAwb === null
          ? `That piece is not picked for this parcel. Scan the pieces for ${openAwb}.`
          : `That piece was picked for parcel ${otherAwb}, not ${openAwb}. Scan the pieces for ${openAwb}.`,
      details: { awb: openAwb, ...(otherAwb === null ? {} : { otherAwb }) },
    };
  }

  /**
   * Name the mistake behind a code that resolved to NOTHING of this
   * client's (2026-11-10, owner).
   *
   * ── WHY THIS EXISTS ──────────────────────────────────────────────────
   * Every one of these used to arrive as `PACK_CODE_UNKNOWN` — "this
   * barcode is not known" — which is false for most of them and useless
   * for all of them. Two were seen in production on the same line: a
   * packer scanning ANOTHER PARCEL'S AWB (38061110627394 while the open
   * box was …395), and a packer scanning a product that belongs to a
   * different client. The owner's words: "it should show that you have
   * scanned a wrong parcel. please scan this awb parcel".
   *
   * ── COST ─────────────────────────────────────────────────────────────
   * Three queries at WORST, and only ever on a path that has already
   * decided to refuse — the happy path is byte-for-byte what it was.
   * They are ordered cheapest-and-most-specific first and each one
   * short-circuits.
   *
   * ── IT ONLY EVER RENAMES A REFUSAL ───────────────────────────────────
   * Every branch throws. Acceptance is decided entirely above this, by
   * the seller-scoped lookup (LBL-2) and the PICKED-unit lookup, and
   * neither moved. The last branch keeps `PACK_CODE_UNKNOWN` — which is
   * now actually TRUE when it fires.
   */
  private async unresolvedCodeRefusal(
    code: string,
    box: { shipmentId: string; openedWithCode: string },
    sellerId: string,
  ): Promise<ConflictException | NotFoundException> {
    // 1 — this box's OWN label, in the product field. Free: no query.
    // The bench normally reads it as "close the box", so this is the
    // hand-typed or whitespace-mangled case, and telling the packer the
    // box is already theirs beats telling them their label is unknown.
    if (code === box.openedWithCode) {
      return new ConflictException({
        code: 'PACK_OWN_LABEL_NOT_A_PRODUCT',
        message: `${code} is this box's own label, not a product. Scan the products that go in, then scan ${box.openedWithCode} again to finish.`,
        details: { awb: box.openedWithCode },
      });
    }

    // 2 — ANOTHER PARCEL'S shipping label. The headline case. The message
    // has to name the AWB the packer SHOULD be holding, because "wrong
    // parcel" without it is a puzzle, not an instruction.
    const otherParcel = await this.prisma.client.shipment.findFirst({
      where: { awbNumber: code, deletedAt: null, supersededAt: null },
      select: { shipmentNumber: true },
    });
    if (otherParcel !== null) {
      return new ConflictException({
        code: 'PACK_WRONG_PARCEL_LABEL',
        message: `${code} is a different parcel's label. This box is parcel ${box.openedWithCode} — set that one aside and scan ${box.openedWithCode}.`,
        details: { awb: box.openedWithCode, otherAwb: code },
      });
    }

    // 3 — a SERIAL we know, in a state the acceptance lookup skips (it
    // takes PICKED only). Unscoped by seller on purpose: the honest
    // answer for somebody else's serial is "somebody else's goods", not
    // "unknown barcode".
    const unit = await this.prisma.client.stockUnit.findFirst({
      where: { serialBarcode: code },
      select: {
        status: true,
        sellerId: true,
        shipmentItem: {
          select: { shipmentId: true, shipment: { select: { awbNumber: true } } },
        },
      },
    });
    if (unit !== null) {
      if (unit.sellerId !== sellerId) return this.otherClientRefusal(code);
      if (unit.shipmentItem?.shipmentId === box.shipmentId) {
        const state = unit.status.toLowerCase().replace(/_/g, ' ');
        return new ConflictException({
          code: 'PACK_UNIT_NOT_PICKED',
          message: `That piece is on this parcel but the stock ledger has it as ${state}, not picked. Put it aside and tell your supervisor.`,
          details: { awb: box.openedWithCode, state },
        });
      }
      // PACK_UNIT_WRONG_PARCEL used to be unreachable for any unit that
      // was not PICKED — the acceptance lookup filters on that status, so
      // the piece fell through to "unknown barcode". It is reached now.
      return new ConflictException(
        this.wrongParcelUnit(box.openedWithCode, unit.shipmentItem?.shipment.awbNumber ?? null),
      );
    }

    // 4 — a real product of a DIFFERENT CLIENT. LBL-2 scopes the
    // acceptance lookup to this parcel's seller precisely because
    // `barcode` is not unique and `skuCode` is unique only per seller;
    // the comment there has said since 2026-09-04 that failing closed on
    // the wrong reason tells a packer "not on this order" when the truth
    // is "that is somebody else's SKU". This is acting on it.
    const foreign = await this.prisma.client.productVariant.findFirst({
      where: {
        sellerId: { not: sellerId },
        deletedAt: null,
        OR: [{ barcode: code }, { skuCode: code }],
      },
      // Existence only. NOT the owning client's name and NOT their SKU:
      // a refusal on this bench may name a colleague (same employer) but
      // never another client's details. The code the packer scanned is
      // echoed instead — it is already in their hand, so it leaks nothing.
      select: { id: true },
    });
    if (foreign !== null) return this.otherClientRefusal(code);

    // 5 — nothing, anywhere. The original code, now telling the truth.
    return new NotFoundException({
      code: 'PACK_CODE_UNKNOWN',
      message: `Nothing matches ${code}`,
    });
  }

  /**
   * Goods that exist and are somebody else's — product or piece alike.
   *
   * It does NOT name the owning client. A refusal on this bench may name a
   * staff colleague (same warehouse, same employer) but never another
   * CLIENT's company or product name, and the stock team can identify the
   * item from the code the packer is holding.
   */
  private otherClientRefusal(scanned: string): ConflictException {
    return new ConflictException({
      code: 'PACK_PRODUCT_OTHER_CLIENT',
      message: `${scanned} is another client's stock, not this parcel's. Hand it to the stock team; it cannot go in this box.`,
      details: { item: scanned },
    });
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
        // Names the label that WOULD close it. "A different parcel's
        // label" alone told the packer which mistake they had made and
        // nothing about how to undo it.
        message: `That is a different parcel’s label. Scan ${box.openedWithCode} — the label this box was opened with.`,
        details: { awb: box.openedWithCode },
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
        expiresAt: true,
      },
    });
    if (box === null) {
      throw new NotFoundException({
        code: 'PACK_BOX_NOT_FOUND',
        message: 'No such box. Scan the shipping label again to start over.',
      });
    }
    if (box.status !== PackBoxStatus.OPEN) {
      throw await this.boxNoLongerOpen(box);
    }
    if (box.packerStaffId !== staffId) {
      // The holder is looked up HERE and not joined into the read above:
      // that read is on the happy path of every single scan, and this one
      // only ever runs on a box that has already been refused.
      const holder = await this.prisma.client.staffUser.findUnique({
        where: { id: box.packerStaffId },
        select: { emailDisplay: true },
      });
      throw new ConflictException(
        this.heldByOther(box.openedWithCode, holder?.emailDisplay ?? null, box.expiresAt),
      );
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
    const thumbs = await this.thumbnails([...variantBySku.values()]);

    return {
      packBoxId: box.id,
      shipmentId: box.shipmentId,
      orderId: box.orderId,
      awbNumber: box.shipment.awbNumber ?? '',
      expiresAt: box.expiresAt,
      expected: [...bySku.values()].map((r) => {
        const variantId = variantBySku.get(r.skuCode) ?? '';
        return {
          variantId,
          skuCode: r.skuCode,
          productName: r.productName,
          quantity: r.quantity,
          imageUrl: thumbs.get(variantId) ?? null,
        };
      }),
      alreadyOpen,
    };
  }

  /**
   * The product's picture for the pack bench, via `CatalogReadService`
   * (MUST #13 — cross-module variant reads go through it).
   *
   * It must be a PRESIGNED url minted at read time, not the snapshotted
   * `order_items.imageUrl`: that column holds the canonical object URL and
   * the bucket has been private since 2026-07-28, so every snapshot taken
   * since resolves for nobody. A dead link on a bench is worse than no
   * picture, because the packer waits for it.
   *
   * FAILS OPEN, exactly as `RtoReadService.thumbnails` does: a thumbnail
   * service that is unavailable costs the lines their pictures and nothing
   * else. A bench that cannot open a box because an image URL could not be
   * signed is a far worse outcome on a warehouse floor.
   */
  private async thumbnails(variantIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const ids = variantIds.filter((id) => id !== '');
    if (ids.length === 0) return new Map();
    try {
      return await this.catalog.thumbnailUrlsByVariant(ids);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Pack line thumbnails unavailable; showing the lines without them (fail-open)',
      );
      return new Map();
    }
  }

  /** Effective box IDLE timeout (minutes): ops.pack_box_timeout_minutes,
   *  else the default. Read on every scan, so changing the setting takes
   *  effect on the next scan rather than on the next restart. Same shape
   *  as the pick-task timeout. */
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
