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
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface DispatchHandoffFailure {
  shipmentId: string;
  orderId: string | null;
  error: string;
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
 * NOTE (the bug-1 fix, commit 12): once the PENDING_DISPATCH → DISPATCHED
 * matrix edge gains the DISPATCH_STOCK side-effect, the SAME
 * transitionStatus call here triggers the qtyOnHand decrement +
 * reservation fulfill. DispatchHandoffService does not change — the
 * matrix edge does.
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
   * Record that a parcel was scanned at the handover bench.
   *
   * Keyed on the AWB because that is what is printed on the label in
   * somebody's hand — not an id they would have to look up.
   *
   * Idempotent by guard: scanning the same parcel twice keeps the FIRST
   * time rather than moving it, so the record says when it was checked
   * rather than when somebody last waved it at a reader.
   */
  async recordHandoverScan(
    awbNumber: string,
    staffId: string,
  ): Promise<{ shipmentNumber: string; alreadyScanned: boolean }> {
    const awb = awbNumber.trim();
    const shipment = await this.prisma.client.shipment.findFirst({
      where: { awbNumber: awb, supersededAt: null, deletedAt: null },
      select: { id: true, shipmentNumber: true, handoverScannedAt: true, status: true },
    });
    if (shipment === null) {
      throw new NotFoundException({
        code: 'AWB_NOT_FOUND',
        message: `No live parcel carries AWB ${awb}`,
      });
    }
    if (shipment.status === ShipmentStatus.HANDED_TO_COURIER) {
      throw new ConflictException({
        code: 'ALREADY_HANDED_OVER',
        message: `${shipment.shipmentNumber} has already gone with a driver`,
      });
    }

    const claimed = await this.prisma.client.shipment.updateMany({
      where: { id: shipment.id, handoverScannedAt: null },
      data: { handoverScannedAt: new Date(), handoverScannedByStaffId: staffId },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'shipment.handover_scanned',
      entityType: 'shipment',
      entityId: shipment.id,
      severity: 'LOW',
      metadata: { awbNumber: awb, alreadyScanned: claimed.count === 0 },
    });

    return { shipmentNumber: shipment.shipmentNumber, alreadyScanned: claimed.count === 0 };
  }

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
