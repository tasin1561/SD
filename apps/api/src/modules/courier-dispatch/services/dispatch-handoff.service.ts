import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import {
  ActorType,
  ManifestStatus,
  OrderStatus,
  ShipmentStatus,
  StockUnitStatus,
  SellerCapability,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SellerRestrictionService } from '../../seller-restriction/services/seller-restriction.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderWriteService } from '../../order/services/order-write.service';
import { StockUnitService } from '../../inventory-shared/stock-unit.service';
import { ScanBlockService } from '../../system-issues/services/scan-block.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface DispatchHandoffFailure {
  shipmentId: string;
  orderId: string | null;
  error: string;
}

/** A parcel can only be handed to a driver once it is boxed and still
 *  in the building. PACKED is the bench's ordinary case (nobody closed a
 *  manifest); PENDING_DISPATCH is the same parcel after somebody did. */
const HANDOVER_READY: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.PACKED,
  OrderStatus.PENDING_DISPATCH,
]);

export interface HandoverScanResult {
  shipmentId: string;
  shipmentNumber: string;
  orderId: string | null;
  /** true ⇒ this parcel already carried a handover scan before this call. */
  alreadyScanned: boolean;
  /** true ⇒ the parcel is now (or was already) with the courier. */
  dispatched: boolean;
  /** true ⇒ this scan was the last one on its manifest, so the manifest
   *  flipped to DISPATCHED without anybody confirming a handoff. */
  manifestDispatched: boolean;
}

export interface DispatchHandoffResult {
  manifestId: string;
  status: ManifestStatus;
  dispatchedShipmentIds: string[];
  transitionedCount: number;
  failures: DispatchHandoffFailure[];
  /** true ⇒ idempotent no-op (manifest already DISPATCHED). */
  alreadyDispatched: boolean;
}

/**
 * Module 9 — per-manifest dispatch handoff (commit 11, CUR-4).
 *
 * A supervisor confirms the manifest's parcels were physically handed
 * to the courier. confirmHandoff transitions every AWB-ready shipment's
 * order PENDING_DISPATCH → DISPATCHED, marks the shipment
 * HANDED_TO_COURIER, and flips the manifest CONFIRMED → DISPATCHED.
 *
 * NOTE (Model C, 2026-09-03): this edge is now STOCK-NEUTRAL — the
 * DISPATCH_STOCK side-effect (qtyOnHand decrement + reservation fulfill)
 * fired earlier, at PICKED → PACKED, when the box was sealed. This
 * transitionStatus call moves no stock; it only reflects that the
 * already-packed parcel physically left. DispatchHandoffService does
 * not change — the matrix edge does.
 *
 * Fan-out discipline (mirrors M8 ManifestService.close): per-shipment
 * failure isolation — a single shipment's transition failure is
 * collected, never aborts the others. Ordering: per-shipment
 * transitions FIRST, the manifest → DISPATCHED flip LAST — so the
 * manifest reaching DISPATCHED genuinely means every shipment was
 * processed, and a mid-run crash leaves the manifest CONFIRMED for a
 * retry-convergent re-run (already-DISPATCHED orders 409-STALE → caught).
 *
 * Idempotent: an already-DISPATCHED manifest → no-op
 * (`alreadyDispatched:true`).
 */
@Injectable()
export class DispatchHandoffService {
  private readonly logger = new Logger(DispatchHandoffService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly restrictions: SellerRestrictionService,
    private readonly audit: AuditLogService,
    private readonly orderWrite: OrderWriteService,
    private readonly units: StockUnitService,
    private readonly scanBlock: ScanBlockService,
  ) {}

  /** One reader for the switch, failing CLOSED-ish: an unreadable
   *  setting resolves to OFF, because a warehouse that cannot hand over
   *  parcels because a settings row would not load is a worse outage
   *  than a missed scan. The same fail-open reasoning as INV mode. */
  private async handoverScanRequired(): Promise<boolean> {
    try {
      const row = await this.prisma.client.systemSetting.findUnique({
        where: { key: 'ops.handover_scan_required' },
        select: { valueBoolean: true },
      });
      return row?.valueBoolean === true;
    } catch {
      return false;
    }
  }

  /**
   * Does a scan at the bench DISPATCH the parcel, or only record that it
   * was checked?
   *
   * ON by default (2026-09-03), because the scan is the truest handover
   * signal the system has: it happens per parcel, at the door, at the
   * moment the box leaves — where confirm-handoff is one person
   * asserting afterwards that forty parcels went. Kept as a switch
   * rather than hardcoded for the same reason auto-pickup is: the day
   * somebody scans parcels to check them IN rather than out, this is the
   * one-line way back without a deploy.
   *
   * Fails OPEN to the old behaviour (stamp only) on an unreadable
   * setting: recording a dispatch that did not happen is worse than
   * making an operator click confirm-handoff.
   */
  private async handoverScanDispatches(): Promise<boolean> {
    try {
      const row = await this.prisma.client.systemSetting.findUnique({
        where: { key: 'ops.handover_scan_dispatches' },
        select: { valueBoolean: true },
      });
      return row?.valueBoolean === true;
    } catch {
      return false;
    }
  }

  /**
   * Scan a parcel at the handover bench — which is what actually hands
   * it to the courier (2026-09-03).
   *
   * Keyed on the AWB because that is what is printed on the label in
   * somebody's hand — not an id they would have to look up. Looking the
   * parcel up BY its waybill also means the "does this have an AWB"
   * gate is satisfied by construction: an unlabelled parcel has nothing
   * to scan, so it simply never reaches a driver, and it stays visibly
   * unscanned rather than going out unbooked.
   *
   * WHY THE SCAN AND NOT A BUTTON: the scan is per parcel, at the door,
   * at the moment the box leaves. `confirmHandoff` is one person
   * asserting afterwards that forty parcels went. Both record the same
   * fact; only one of them was there. The button survives as the
   * fallback for a driver who takes a stack before anyone scans it.
   *
   * SAGA, visible-vs-silent ordering (same shape as manual placement):
   *   1. STAMP FIRST — `handoverScannedAt` via a guarded `updateMany`,
   *      so it records when the parcel was checked, not when somebody
   *      last waved it at a reader.
   *   2. TRANSITION LAST — the order to DISPATCHED (PACKED → DISPATCHED
   *      when nobody closed a manifest, PENDING_DISPATCH → DISPATCHED
   *      when somebody did; both edges are stock-neutral under Model C,
   *      because qtyOnHand already moved at pack).
   * A crash between leaves a scanned-but-undispatched parcel — visible,
   * and a re-scan converges (the stamp no-ops, the transition re-runs).
   *
   * A REPEAT SCAN STOPS THE OPERATOR (2026-09-04). Scanning a parcel
   * that has already gone means either two boxes carry one label or the
   * pile has already been loaded — both wrong, both worse the longer
   * they run, and neither visible to anyone but the person holding the
   * box. So it refuses and keeps refusing until an admin resolves the
   * issue (`ScanBlockService`). This deliberately REPLACES an earlier
   * decision to treat a repeat as a harmless no-op: that optimised for
   * the operator who is unsure whether the first scan registered, which
   * the session list on screen already answers, at the cost of hiding
   * the duplicate that matters.
   */
  async recordHandoverScan(
    awbNumber: string,
    staffId: string,
    ctx?: ClientContext,
  ): Promise<HandoverScanResult> {
    // Blocked operators stop at the DOOR, before the lookup: the stop is
    // about the pile, not only about the box that caused it.
    await this.scanBlock.assertNotBlocked(staffId);

    const awb = awbNumber.trim();
    const shipment = await this.prisma.client.shipment.findFirst({
      where: { awbNumber: awb, supersededAt: null, deletedAt: null },
      select: {
        id: true,
        shipmentNumber: true,
        handoverScannedAt: true,
        status: true,
        manifestId: true,
        orderShipments: {
          select: { orderId: true, order: { select: { status: true, sellerId: true } } },
          orderBy: { shipmentSequence: 'asc' },
          take: 1,
        },
      },
    });
    if (shipment === null) {
      throw new NotFoundException({
        code: 'AWB_NOT_FOUND',
        message: `No live parcel carries AWB ${awb}`,
      });
    }
    const orderId = shipment.orderShipments[0]?.orderId ?? null;
    const orderStatus = shipment.orderShipments[0]?.order.status ?? null;
    const sellerId = shipment.orderShipments[0]?.order.sellerId ?? null;

    // Already gone — the duplicate this whole mechanism exists for.
    if (shipment.status === ShipmentStatus.HANDED_TO_COURIER) {
      await this.scanBlock.refuseDuplicate({
        flow: 'HANDOVER',
        staffId,
        shipmentId: shipment.id,
        shipmentNumber: shipment.shipmentNumber,
        awbNumber: awb,
        observed: 'with the courier',
      });
    }

    const dispatches = await this.handoverScanDispatches();

    // The parcel has to be packed and still here. Anything else is
    // named, because "cannot scan this" sends somebody hunting.
    if (dispatches && orderStatus !== null && !HANDOVER_READY.has(orderStatus)) {
      throw new ConflictException({
        code: 'NOT_READY_FOR_HANDOVER',
        message:
          `${shipment.shipmentNumber} is ${orderStatus} — a parcel can only be handed over ` +
          `once it is packed (PACKED or PENDING_DISPATCH)`,
      });
    }
    if (dispatches && sellerId !== null) {
      await this.restrictions.assertAllowed(sellerId, SellerCapability.SHIPMENT_DISPATCH);
    }

    // 1. STAMP FIRST (durable, operational, visible).
    const now = new Date();
    const claimed = await this.prisma.client.shipment.updateMany({
      where: { id: shipment.id, handoverScannedAt: null },
      data: { handoverScannedAt: now, handoverScannedByStaffId: staffId },
    });
    const alreadyScanned = claimed.count === 0;

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'shipment.handover_scanned',
      entityType: 'shipment',
      entityId: shipment.id,
      severity: 'LOW',
      metadata: {
        awbNumber: awb,
        alreadyScanned,
        dispatchesOnScan: dispatches,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    // Switch OFF: the old behaviour — the scan is a record, and a
    // supervisor still confirms the handoff per manifest.
    if (!dispatches || orderId === null || orderStatus === null) {
      return {
        shipmentId: shipment.id,
        shipmentNumber: shipment.shipmentNumber,
        orderId,
        alreadyScanned,
        dispatched: false,
        manifestDispatched: false,
      };
    }

    // 2. TRANSITION LAST — the authoritative "it left with a driver".
    //
    // A scan gun types the code and presses Enter by itself, and it
    // sometimes fires twice. Both calls read the parcel before either
    // stamps it, so both get past the duplicate check above and both
    // arrive here — one wins, the other finds the order already moved.
    // That is ONE box scanned once by a twitchy reader, not a repeated
    // box, so it converges quietly instead of stopping the operator.
    // The genuine duplicate is the one caught above, where the parcel
    // was already HANDED_TO_COURIER before this scan began.
    try {
      await this.orderWrite.transitionStatus({
        orderId,
        to: OrderStatus.DISPATCHED,
        actor: { type: ActorType.STAFF, id: staffId },
        expectedFrom: orderStatus,
        reason: `Handed to courier at the bench (scanned ${awb})`,
        ...(ctx !== undefined ? { ctx } : {}),
      });
    } catch (err) {
      const settled = await this.prisma.client.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      if (settled?.status !== OrderStatus.DISPATCHED) throw err;
      this.logger.log(
        { shipmentId: shipment.id, orderId },
        'Handover scan raced a concurrent scan of the same parcel — already dispatched, converging',
      );
      return {
        shipmentId: shipment.id,
        shipmentNumber: shipment.shipmentNumber,
        orderId,
        alreadyScanned: true,
        dispatched: true,
        manifestDispatched: false,
      };
    }
    await this.prisma.client.shipment.update({
      where: { id: shipment.id },
      data: { status: ShipmentStatus.HANDED_TO_COURIER, pickedUpByCourierAt: now },
    });

    // R4 — the parcel left the building: walk its serialized units
    // PACKED → DISPATCHED. Best-effort and guarded on fromStatus for the
    // same reason as confirmHandoff: the courier already has the box, so
    // a unit-ledger hiccup must not undo a real-world handover.
    try {
      await this.prisma.client.$transaction((tx) =>
        this.units.advanceUnitsForShipment(tx, {
          shipmentId: shipment.id,
          fromStatus: StockUnitStatus.PACKED,
          toStatus: StockUnitStatus.DISPATCHED,
          gate: 'DISPATCH',
          actorType: ActorType.STAFF,
          actorId: staffId,
        }),
      );
    } catch (unitErr) {
      this.logger.warn(
        { shipmentId: shipment.id, err: (unitErr as Error).message },
        'Handover scan: unit ledger advance failed — parcel IS dispatched; discrepancy report will surface the units',
      );
    }

    const manifestDispatched =
      shipment.manifestId === null
        ? false
        : await this.flipManifestIfComplete(shipment.manifestId, staffId, ctx);

    return {
      shipmentId: shipment.id,
      shipmentNumber: shipment.shipmentNumber,
      orderId,
      alreadyScanned,
      dispatched: true,
      manifestDispatched,
    };
  }

  /**
   * Close the manifest out once its last parcel has been scanned.
   *
   * The manifest stops being something anybody operates: it is created
   * for you at pack (WMS-7) and finished for you here. It survives as
   * the grouping that answers "what went on Tuesday's van", which is a
   * real question and is not answerable from a pile of parcels.
   *
   * Deliberately accepts ANY non-DISPATCHED state, including DRAFT. With
   * the bench dispatching directly, a manifest nobody ever closed is the
   * ORDINARY case, not an anomaly — and leaving it DRAFT while every one
   * of its parcels is with a courier would be a lie in the one record
   * kept for exactly that question.
   *
   * "Complete" means every LIVE parcel on it is HANDED_TO_COURIER. A
   * parcel still sitting there — no AWB, unscanned, superseded onto a
   * different manifest — holds the manifest open, which is the visible
   * signal that something did not go.
   */
  private async flipManifestIfComplete(
    manifestId: string,
    staffId: string,
    ctx?: ClientContext,
  ): Promise<boolean> {
    const live = await this.prisma.client.shipment.findMany({
      where: {
        manifestId,
        supersededAt: null,
        deletedAt: null,
        status: { not: ShipmentStatus.CANCELLED },
      },
      select: { id: true, status: true },
    });
    if (live.length === 0) return false;
    if (live.some((sh) => sh.status !== ShipmentStatus.HANDED_TO_COURIER)) return false;

    const now = new Date();
    const flipped = await this.prisma.client.manifest.updateMany({
      where: { id: manifestId, status: { not: ManifestStatus.DISPATCHED } },
      data: {
        status: ManifestStatus.DISPATCHED,
        handoffConfirmedAt: now,
        handoffConfirmedByStaffId: staffId,
      },
    });
    if (flipped.count === 0) return false;

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'manifest.dispatched',
      entityType: 'manifest',
      entityId: manifestId,
      severity: 'MEDIUM',
      metadata: {
        via: 'handover_scan',
        shipmentCount: live.length,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });
    return true;
  }

  /**
   * The MANUAL fallback: a supervisor confirms, per manifest, that the
   * driver took the parcels.
   *
   * With the bench dispatching each parcel as it is scanned, this is no
   * longer the ordinary path — it is what you reach for when a driver
   * took a stack before anybody scanned it, or when
   * `ops.handover_scan_dispatches` is switched off. Parcels already
   * dispatched by a scan are skipped by the `expectedFrom` guard and
   * land in `failures` as stale-status, which is why a mixed manifest
   * still closes out cleanly.
   */
  async confirmHandoff(
    manifestId: string,
    /**
     * The staff member who confirmed the driver took the parcels, or
     * NULL when the system did it unattended.
     *
     * Nullable on purpose: crediting the packer with confirming a
     * handoff they were not present for puts a name against a physical
     * assertion nobody made. Both manifest columns are already nullable
     * and the audit carries ActorType.SYSTEM, so "nobody watched this
     * leave" stays distinguishable from "somebody did".
     */
    staffId: string | null,
    ctx?: ClientContext,
  ): Promise<DispatchHandoffResult> {
    const manifest = await this.prisma.client.manifest.findUnique({
      where: { id: manifestId },
      select: {
        id: true,
        manifestNumber: true,
        status: true,
        shipments: {
          // "Has an AWB and has not gone yet" — selected on `awbNumber`
          // rather than on status. The AWB is now generated at order
          // confirmation, and advancing the status there would take the
          // parcel out of the pick and pack queues, so the shipment sits
          // in CREATED with a real AWB on it until this hand-over.
          // CUR-9 already names `awbNumber` the authoritative fact.
          where: { awbNumber: { not: null }, supersededAt: null, deletedAt: null },
          select: {
            id: true,
            shipmentNumber: true,
            handoverScannedAt: true,
            orderShipments: {
              // The seller comes through the ORDER — a shipment has no
              // seller of its own.
              select: { orderId: true, order: { select: { sellerId: true } } },
              orderBy: { shipmentSequence: 'asc' },
              take: 1,
            },
          },
        },
      },
    });
    if (!manifest) {
      throw new NotFoundException({
        code: 'MANIFEST_NOT_FOUND',
        message: `Manifest ${manifestId} not found`,
      });
    }

    /**
     * THE HANDOVER SCAN GATE (`ops.handover_scan_required`).
     *
     * Enforced HERE, in the service, rather than by hiding a button.
     * The whole point of the setting is that when it is on, nothing
     * reaches a driver unscanned — and a check that lives in the UI is
     * one `curl` away from not existing. A screen can only ever be a
     * convenience on top of this.
     *
     * The refusal NAMES the parcels, because "some of these were not
     * scanned" sends somebody to check all forty.
     *
     * Off by default: it adds a step to every handover, and a step
     * nobody chose is a step that gets worked around.
     */
    const scanRequired = await this.handoverScanRequired();
    if (scanRequired) {
      const unscanned = manifest.shipments.filter((sh) => sh.handoverScannedAt === null);
      if (unscanned.length > 0) {
        throw new ConflictException({
          code: 'HANDOVER_SCAN_REQUIRED',
          message:
            `Scan these at the handover bench before the driver takes them: ` +
            `${unscanned.map((sh) => sh.shipmentNumber).join(', ')}`,
        });
      }
    }
    const dispatchedShipmentIds = manifest.shipments.map((s) => s.id);

    if (manifest.status === ManifestStatus.DISPATCHED) {
      return {
        manifestId,
        status: ManifestStatus.DISPATCHED,
        dispatchedShipmentIds,
        transitionedCount: 0,
        failures: [],
        alreadyDispatched: true,
      };
    }
    if (manifest.status !== ManifestStatus.CONFIRMED) {
      throw new ConflictException({
        code: 'MANIFEST_NOT_DISPATCHABLE',
        message: `Manifest is ${manifest.status}; handoff requires CONFIRMED (AWB generation complete)`,
      });
    }

    const actor =
      staffId === null
        ? { type: ActorType.SYSTEM, id: null }
        : { type: ActorType.STAFF, id: staffId };
    const now = new Date();
    let transitionedCount = 0;
    const failures: DispatchHandoffFailure[] = [];

    // Per-shipment transitions FIRST (failure-isolated).
    for (const ship of manifest.shipments) {
      const orderId = ship.orderShipments[0]?.orderId ?? null;
      if (orderId === null) {
        failures.push({
          shipmentId: ship.id,
          orderId: null,
          error: 'ORDER_SHIPMENT_MISSING',
        });
        continue;
      }
      try {
        // A seller on hold has THEIR parcels skipped — the manifest is
        // not abandoned. One manifest can carry several sellers, and
        // refusing the whole handoff over one of them would strand
        // everybody else's parcels at the counter with the van waiting.
        //
        // Recorded as a failure rather than passed over silently: an
        // operator handing over a stack needs to know which ones came
        // back, and the courier is standing there.
        const sellerId = ship.orderShipments[0]?.order.sellerId ?? null;
        if (sellerId !== null) {
          await this.restrictions.assertAllowed(sellerId, SellerCapability.SHIPMENT_DISPATCH);
        }
        await this.orderWrite.transitionStatus({
          orderId,
          to: OrderStatus.DISPATCHED,
          actor,
          expectedFrom: OrderStatus.PENDING_DISPATCH,
          reason: `Manifest ${manifest.manifestNumber} handed to courier`,
          ...(ctx !== undefined ? { ctx } : {}),
        });
        await this.prisma.client.shipment.update({
          where: { id: ship.id },
          data: {
            status: ShipmentStatus.HANDED_TO_COURIER,
            pickedUpByCourierAt: now,
          },
        });
        // R4 — the parcel left the building: walk its serialized units
        // PACKED → DISPATCHED. Parcel-grained, not per-unit-scanned (at
        // handoff the AWB label IS the scanned thing; the units were
        // verified one-by-one at pack). Guarded on fromStatus, so a
        // re-run of a partially-processed manifest moves nothing twice.
        // Best-effort: the courier already has the box, so a unit-ledger
        // hiccup must not undo a real-world handoff — it surfaces in the
        // discrepancy report instead.
        try {
          await this.prisma.client.$transaction((tx) =>
            this.units.advanceUnitsForShipment(tx, {
              shipmentId: ship.id,
              fromStatus: StockUnitStatus.PACKED,
              toStatus: StockUnitStatus.DISPATCHED,
              gate: 'DISPATCH',
              actorType: actor.type,
              actorId: staffId,
            }),
          );
        } catch (unitErr) {
          this.logger.warn(
            {
              manifestId,
              shipmentId: ship.id,
              err: (unitErr as Error).message,
            },
            'Dispatch handoff: unit ledger advance failed — parcel IS dispatched; discrepancy report will surface the units',
          );
        }
        transitionedCount += 1;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          { manifestId, shipmentId: ship.id, orderId, err: message },
          'Dispatch handoff: shipment transition failed — isolated, continuing',
        );
        failures.push({ shipmentId: ship.id, orderId, error: message });
      }
    }

    // Manifest → DISPATCHED LAST — reaching it means every shipment was
    // processed (retry-convergent: a mid-run crash leaves CONFIRMED).
    await this.prisma.client.manifest.update({
      where: { id: manifestId },
      data: {
        status: ManifestStatus.DISPATCHED,
        handoffConfirmedAt: now,
        handoffConfirmedByStaffId: staffId,
      },
    });

    await this.audit.log({
      actorType: actor.type,
      actorId: staffId,
      action: 'manifest.dispatched',
      entityType: 'manifest',
      entityId: manifestId,
      severity: failures.length > 0 ? 'HIGH' : 'MEDIUM',
      metadata: {
        manifestNumber: manifest.manifestNumber,
        dispatchedShipmentIds,
        transitionedCount,
        failureCount: failures.length,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    return {
      manifestId,
      status: ManifestStatus.DISPATCHED,
      dispatchedShipmentIds,
      transitionedCount,
      failures,
      alreadyDispatched: false,
    };
  }
}
