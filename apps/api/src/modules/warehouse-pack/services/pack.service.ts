import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, OrderStatus, ShipmentStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderReadService } from '../../order/services/order-read.service';
import { OrderWriteService } from '../../order/services/order-write.service';
import { ManifestService } from '../../warehouse-manifest/services/manifest.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface CompletePackResult {
  shipmentId: string;
  orderId: string;
  status: OrderStatus;
  packCompletedAt: Date;
  manifestId: string | null;
  manifestNumber: string | null;
  /** true ⇒ idempotent no-op (shipment already PACKED + stamped). */
  alreadyComplete: boolean;
}

/**
 * Module 8 — pack execution (commit 9). The packer completes a parcel:
 * atomic stamp → PICKED→PACKED → auto-attach to DRAFT manifest (WMS-7).
 *
 * ── SAGA DISCIPLINE (mirrors PickExecutionService.complete) ───────────
 *  1. OPERATIONAL stamp FIRST — atomic guarded UPDATE on
 *     (status=CREATED, pack_completed_at IS NULL): sets packCompletedAt
 *     + packedByStaffId. Count=0 → 409 PACK_NOT_AVAILABLE (idempotent on
 *     retry). This is the race-resolution point (commit-9 design:
 *     pull is claim-free; complete IS the claim).
 *  2. AUTHORITATIVE transition LAST — transitionStatus PICKED→PACKED
 *     (expectedFrom PICKED), its own tx (matrix side-effect: NONE).
 *  3. POST-COMMIT auto-attach (WMS-7) — ManifestService.attachShipment
 *     (find-or-create the DRAFT manifest for the shipment's
 *     courier+warehouse, attach the shipment). Best-effort: a failure
 *     is logged, NEVER thrown upstream — the shipment is correctly
 *     PACKED, manifest assignment is an independent operational step
 *     the supervisor can retry/reassign (mirrors INV-5 / CC-6 post-commit
 *     discipline). attachShipment is idempotent (alreadyAttached
 *     no-op on retry).
 *
 * Idempotency: an already-PACKED + stamped shipment short-circuits at
 * the top with `alreadyComplete:true` + current manifest snapshot.
 */
@Injectable()
export class PackService {
  private readonly logger = new Logger(PackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly orders: OrderReadService,
    private readonly orderWrite: OrderWriteService,
    private readonly manifests: ManifestService,
  ) {}

  async complete(
    shipmentId: string,
    staffId: string,
    ctx?: ClientContext,
  ): Promise<CompletePackResult> {
    const shipment = await this.prisma.client.shipment.findFirst({
      where: { id: shipmentId, deletedAt: null },
      select: {
        id: true,
        status: true,
        packCompletedAt: true,
        manifestId: true,
        manifest: { select: { manifestNumber: true } },
        orderShipments: {
          select: { orderId: true },
          orderBy: { shipmentSequence: 'asc' },
          take: 1,
        },
      },
    });
    if (!shipment) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: `Shipment ${shipmentId} not found`,
      });
    }
    if (shipment.status !== ShipmentStatus.CREATED) {
      throw new ConflictException({
        code: 'SHIPMENT_NOT_PACKABLE',
        message: `Shipment is ${shipment.status}; pack operations require CREATED`,
      });
    }
    const orderId = shipment.orderShipments[0]?.orderId;
    if (orderId === undefined) {
      throw new NotFoundException({
        code: 'ORDER_SHIPMENT_MISSING',
        message: `Shipment ${shipmentId} has no OrderShipment junction`,
      });
    }
    const order = await this.orders.getById(orderId);
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: `Order ${orderId} for shipment ${shipmentId} not found`,
      });
    }

    // Idempotent short-circuit: already PACKED + stamped.
    if (
      order.status === OrderStatus.PACKED &&
      shipment.packCompletedAt !== null
    ) {
      return {
        shipmentId,
        orderId,
        status: OrderStatus.PACKED,
        packCompletedAt: shipment.packCompletedAt,
        manifestId: shipment.manifestId,
        manifestNumber: shipment.manifest?.manifestNumber ?? null,
        alreadyComplete: true,
      };
    }
    if (order.status !== OrderStatus.PICKED) {
      throw new ConflictException({
        code: 'ORDER_NOT_PACKABLE',
        message: `Order is ${order.status}; pack complete requires PICKED`,
      });
    }

    const now = new Date();
    // 1. OPERATIONAL stamp + race resolution.
    const stamped = await this.prisma.client.shipment.updateMany({
      where: {
        id: shipmentId,
        status: ShipmentStatus.CREATED,
        packCompletedAt: null,
      },
      data: { packCompletedAt: now, packedByStaffId: staffId },
    });
    if (stamped.count !== 1) {
      throw new ConflictException({
        code: 'PACK_NOT_AVAILABLE',
        message: 'Shipment was already packed by another packer (or no longer packable)',
      });
    }

    // 2. AUTHORITATIVE transition.
    await this.orderWrite.transitionStatus({
      orderId,
      to: OrderStatus.PACKED,
      actor: { type: ActorType.STAFF, id: staffId },
      expectedFrom: OrderStatus.PICKED,
      reason: `Pack completed on shipment ${shipmentId}`,
      ...(ctx !== undefined ? { ctx } : {}),
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'warehouse_pack.completed',
      entityType: 'shipment',
      entityId: shipmentId,
      severity: 'LOW',
      metadata: {
        orderId,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    // 3. POST-COMMIT auto-attach (WMS-7). Best-effort + idempotent.
    let manifestId: string | null = null;
    let manifestNumber: string | null = null;
    try {
      const attached = await this.manifests.attachShipment(
        shipmentId,
        { type: ActorType.STAFF, id: staffId },
        ctx,
      );
      manifestId = attached.manifestId;
      manifestNumber = attached.manifestNumber;
    } catch (err) {
      this.logger.warn(
        { shipmentId, orderId, err: (err as Error).message },
        'Pack-complete auto-attach to DRAFT manifest failed — supervisor can retry/reassign',
      );
    }

    return {
      shipmentId,
      orderId,
      status: OrderStatus.PACKED,
      packCompletedAt: now,
      manifestId,
      manifestNumber,
      alreadyComplete: false,
    };
  }
}
