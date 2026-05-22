import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import {
  ActorType,
  ManifestStatus,
  OrderStatus,
  ShipmentStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderWriteService } from '../../order/services/order-write.service';
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
    private readonly audit: AuditLogService,
    private readonly orderWrite: OrderWriteService,
  ) {}

  async confirmHandoff(
    manifestId: string,
    staffId: string,
    ctx?: ClientContext,
  ): Promise<DispatchHandoffResult> {
    const manifest = await this.prisma.client.manifest.findUnique({
      where: { id: manifestId },
      select: {
        id: true,
        manifestNumber: true,
        status: true,
        shipments: {
          where: { status: ShipmentStatus.AWB_GENERATED },
          select: {
            id: true,
            orderShipments: {
              select: { orderId: true },
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

    const actor = { type: ActorType.STAFF, id: staffId };
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
      actorType: ActorType.STAFF,
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
