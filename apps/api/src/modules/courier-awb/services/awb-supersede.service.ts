import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ActorType, ShipmentStatus, SupersedeReason } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { ShipmentNumberingService } from '../../shipment-provision/services/shipment-numbering.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface SupersedeResult {
  oldShipmentId: string;
  newShipmentId: string;
  newShipmentNumber: string;
  orderId: string;
  /** true ⇒ idempotent no-op — the old shipment was already superseded;
   *  the EXISTING replacement is returned (safe BullMQ retry, CUR-9). */
  alreadySuperseded: boolean;
}

/**
 * Module 9 — AWB supersede chain (commit 7, CUR-7).
 *
 * When a shipment's AWB generation fails (Delhivery rejection,
 * non-serviceable destination, courier failure) the failed shipment is
 * RETIRED and a fresh REPLACEMENT parcel-record is created. History is
 * preserved + the chain is traceable:
 *
 *   - OLD shipment → status FAILED_AT_CREATION, `supersededAt` +
 *     `supersedeReason` stamped, `manifestId` cleared (pulled out of
 *     the dispatch manifest). The row is NEVER deleted.
 *   - NEW shipment → a copy of the parcel (dest snapshot + physical +
 *     economics + pick/pack operational state — the goods ARE picked
 *     and packed), status CREATED, `supersedesShipmentId = OLD.id` (the
 *     NEW→OLD FK), no AWB / no manifest. Its shipment_items copy the
 *     old line snapshots + pick context. A new OrderShipment junction
 *     links it to the same order (shipmentSequence incremented).
 *
 * The caller (AWB job, commit 9) transitions the ORDER to
 * PENDING_MANUAL_PLACEMENT — supersede is a SHIPMENT-LEVEL mechanism
 * only; it does not touch order status (WMS-9 / ORD-3 separation).
 *
 * Shipment-grained throughout (operates on a shipmentId; idempotency
 * keyed on the old shipment's `supersededAt`) — split-shipment orders
 * are handled correctly by construction.
 *
 * Idempotent: an already-superseded old shipment returns its existing
 * replacement (`alreadySuperseded:true`) — a retried AWB job never
 * creates a second replacement.
 */
@Injectable()
export class AwbSupersedeService {
  private readonly logger = new Logger(AwbSupersedeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly numbering: ShipmentNumberingService,
  ) {}

  async supersede(
    oldShipmentId: string,
    reason: SupersedeReason,
    actor: { type: ActorType; id?: string | null } = { type: ActorType.SYSTEM },
    ctx?: ClientContext,
  ): Promise<SupersedeResult> {
    const old = await this.prisma.client.shipment.findUnique({
      where: { id: oldShipmentId },
      select: {
        id: true,
        supersededAt: true,
        courierCode: true,
        originWarehouseId: true,
        serviceType: true,
        destRecipientName: true,
        destRecipientPhoneE164: true,
        destAddressLine1: true,
        destAddressLine2: true,
        destLandmark: true,
        destCity: true,
        destStateProvince: true,
        destPostalCode: true,
        destCountryCode: true,
        totalWeightGrams: true,
        declaredWeightGrams: true,
        actualWeightGrams: true,
        lengthCm: true,
        widthCm: true,
        heightCm: true,
        volumetricWeightGrams: true,
        chargeableWeightGrams: true,
        packageType: true,
        declaredValueInr: true,
        codAmountInr: true,
        pickStartedAt: true,
        pickStartedByStaffId: true,
        pickCompletedAt: true,
        packCompletedAt: true,
        packedByStaffId: true,
        orderShipments: {
          select: { orderId: true, isFullOrder: true, shipmentSequence: true },
          orderBy: { shipmentSequence: 'desc' },
        },
        items: {
          select: {
            orderItemId: true,
            quantity: true,
            skuCode: true,
            productName: true,
            variantLabel: true,
            unitWeightGrams: true,
            unitDeclaredValueInr: true,
            unitPriceInr: true,
            pickedBatchId: true,
            pickedBinId: true,
          },
        },
      },
    });
    if (!old) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: `Shipment ${oldShipmentId} not found`,
      });
    }
    const orderShipment = old.orderShipments[0];
    if (!orderShipment) {
      throw new NotFoundException({
        code: 'ORDER_SHIPMENT_MISSING',
        message: `Shipment ${oldShipmentId} has no OrderShipment junction`,
      });
    }
    const orderId = orderShipment.orderId;

    // Idempotency (CUR-9): already superseded → return the existing
    // replacement. A retried AWB job must not create a 2nd replacement.
    if (old.supersededAt !== null) {
      const existing = await this.prisma.client.shipment.findFirst({
        where: { supersedesShipmentId: oldShipmentId },
        select: { id: true, shipmentNumber: true },
      });
      if (existing) {
        return {
          oldShipmentId,
          newShipmentId: existing.id,
          newShipmentNumber: existing.shipmentNumber,
          orderId,
          alreadySuperseded: true,
        };
      }
      // Superseded marker set but no replacement row — a prior partial
      // failure. Fall through to (re)create the replacement.
      this.logger.warn(
        { oldShipmentId },
        'Shipment marked superseded but no replacement found — recreating',
      );
    }

    const now = new Date();
    const result = await this.prisma.client.$transaction(async (tx) => {
      const newShipmentNumber = await this.numbering.nextShipmentNumber(tx);
      const created = await tx.shipment.create({
        data: {
          shipmentNumber: newShipmentNumber,
          courierCode: old.courierCode,
          originWarehouseId: old.originWarehouseId,
          serviceType: old.serviceType,
          status: ShipmentStatus.CREATED,
          supersedesShipmentId: oldShipmentId,
          // Dest snapshot — immutable, copied verbatim.
          destRecipientName: old.destRecipientName,
          destRecipientPhoneE164: old.destRecipientPhoneE164,
          destAddressLine1: old.destAddressLine1,
          destAddressLine2: old.destAddressLine2,
          destLandmark: old.destLandmark,
          destCity: old.destCity,
          destStateProvince: old.destStateProvince,
          destPostalCode: old.destPostalCode,
          destCountryCode: old.destCountryCode,
          // Physical + economics.
          totalWeightGrams: old.totalWeightGrams,
          declaredWeightGrams: old.declaredWeightGrams,
          actualWeightGrams: old.actualWeightGrams,
          lengthCm: old.lengthCm,
          widthCm: old.widthCm,
          heightCm: old.heightCm,
          volumetricWeightGrams: old.volumetricWeightGrams,
          chargeableWeightGrams: old.chargeableWeightGrams,
          packageType: old.packageType,
          declaredValueInr: old.declaredValueInr,
          codAmountInr: old.codAmountInr,
          // Pick/pack operational state — the goods ARE physically
          // picked + packed; the replacement parcel-record reflects that.
          pickStartedAt: old.pickStartedAt,
          pickStartedByStaffId: old.pickStartedByStaffId,
          pickCompletedAt: old.pickCompletedAt,
          packCompletedAt: old.packCompletedAt,
          packedByStaffId: old.packedByStaffId,
          // AWB + manifest deliberately RESET — the replacement has no
          // AWB and is not in a manifest (manual placement, CUR-8).
          items: {
            create: old.items.map((i) => ({
              orderItemId: i.orderItemId,
              quantity: i.quantity,
              skuCode: i.skuCode,
              productName: i.productName,
              variantLabel: i.variantLabel,
              unitWeightGrams: i.unitWeightGrams,
              unitDeclaredValueInr: i.unitDeclaredValueInr,
              unitPriceInr: i.unitPriceInr,
              pickedBatchId: i.pickedBatchId,
              pickedBinId: i.pickedBinId,
            })),
          },
          orderShipments: {
            create: {
              orderId,
              isFullOrder: orderShipment.isFullOrder,
              shipmentSequence: orderShipment.shipmentSequence + 1,
            },
          },
        },
        select: { id: true, shipmentNumber: true },
      });

      await tx.shipment.update({
        where: { id: oldShipmentId },
        data: {
          status: ShipmentStatus.FAILED_AT_CREATION,
          supersededAt: now,
          supersedeReason: reason,
          manifestId: null,
        },
      });

      await this.audit.log(
        {
          actorType: actor.type,
          actorId: actor.id ?? null,
          action: 'shipment.superseded',
          entityType: 'shipment',
          entityId: oldShipmentId,
          severity: 'MEDIUM',
          metadata: {
            orderId,
            oldShipmentId,
            newShipmentId: created.id,
            newShipmentNumber: created.shipmentNumber,
            reason,
            ipAddress: ctx?.ipAddress ?? null,
            userAgent: ctx?.userAgent ?? null,
            requestId: ctx?.requestId ?? null,
          },
        },
        tx,
      );

      return created;
    });

    return {
      oldShipmentId,
      newShipmentId: result.id,
      newShipmentNumber: result.shipmentNumber,
      orderId,
      alreadySuperseded: false,
    };
  }
}
