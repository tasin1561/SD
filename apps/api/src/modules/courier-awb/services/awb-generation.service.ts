import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  LabelGenerationReason,
  ShipmentStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../../config/env.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { DelhiveryAwbService } from '../../courier-delhivery/services/delhivery-awb.service';
import { DelhiveryLabelService } from '../../courier-delhivery/services/delhivery-label.service';
import type { DelhiveryAwbRequest } from '../../courier-delhivery/types/delhivery.types';

export type AwbGenerationOutcome =
  | {
      status: 'GENERATED';
      shipmentId: string;
      awbNumber: string;
      courierShipmentId: string;
      labelSpacesKey: string;
      labelVersion: number;
    }
  | {
      /** CUR-9 idempotent skip — the shipment already carries an AWB. */
      status: 'ALREADY_HAS_AWB';
      shipmentId: string;
      awbNumber: string;
    }
  | {
      status: 'FAILED';
      shipmentId: string;
      /** false ⇒ Delhivery rejected the destination as non-serviceable
       *  (CUR-5) — the caller (AWB job) auto-supersedes → manual
       *  placement. true ⇒ a transient/other failure. */
      serviceable: boolean;
      errorCode: string;
      errorMessage: string;
    };

/**
 * Module 9 — per-shipment AWB generation (commit 8, CUR-6 + CUR-9).
 *
 * generateForShipment:
 *   1. CUR-9 idempotency — a shipment that ALREADY has an awbNumber is
 *      SKIPPED (`ALREADY_HAS_AWB`), never re-generated. The skip IS the
 *      gate that makes a BullMQ retry safe (and, in real mode, prevents
 *      a double Delhivery call / double charge).
 *   2. Marshal a DelhiveryAwbRequest from the shipment's immutable dest
 *      snapshot + line snapshots, call the (mockable) DelhiveryAwbService.
 *   3. On failure → return `FAILED` with the `serviceable` flag; NO DB
 *      write. The AWB job (commit 9) owns the supersede + order-status
 *      routing.
 *   4. On success → fetch the label (DelhiveryLabelService), upload the
 *      bytes to OUR Spaces (CUR-6), then in ONE tx: stamp the shipment
 *      (awbNumber / courierShipmentId / awbGeneratedAt / status
 *      AWB_GENERATED) + insert the awb_labels row (versioned, isCurrent;
 *      a prior current label, if any, is demoted). Audit awb.generated.
 *
 * Shipment-grained: operates on a shipmentId; CUR-9 idempotency keyed
 * on shipment.awbNumber. Split-shipment orders correct by construction.
 *
 * NOTE (real-mode, TODO(delhivery-api) / phase-1a-debt): the label
 * upload precedes the persist tx. If the upload fails AFTER Delhivery
 * issued a real AWB, that AWB is generated-but-unpersisted and the
 * retry re-generates. The stub adapter is deterministic so this is
 * inert in Phase 1A; a real-mode fix (persist awbNumber first, label
 * async) is tracked in phase-1a-debt.
 */
@Injectable()
export class AwbGenerationService {
  private readonly logger = new Logger(AwbGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly spaces: SpacesService,
    private readonly audit: AuditLogService,
    private readonly delhiveryAwb: DelhiveryAwbService,
    private readonly delhiveryLabel: DelhiveryLabelService,
  ) {}

  async generateForShipment(
    shipmentId: string,
    actor: { type: ActorType; id?: string | null } = { type: ActorType.SYSTEM },
  ): Promise<AwbGenerationOutcome> {
    const shipment = await this.prisma.client.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        shipmentNumber: true,
        awbNumber: true,
        status: true,
        destRecipientName: true,
        destRecipientPhoneE164: true,
        destAddressLine1: true,
        destAddressLine2: true,
        destCity: true,
        destStateProvince: true,
        destPostalCode: true,
        destCountryCode: true,
        totalWeightGrams: true,
        declaredValueInr: true,
        codAmountInr: true,
        items: {
          select: { productName: true, quantity: true },
        },
      },
    });
    if (!shipment) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: `Shipment ${shipmentId} not found`,
      });
    }

    // CUR-9: never re-generate an AWB.
    if (shipment.awbNumber !== null) {
      return {
        status: 'ALREADY_HAS_AWB',
        shipmentId,
        awbNumber: shipment.awbNumber,
      };
    }
    if (shipment.status !== ShipmentStatus.CREATED) {
      throw new ConflictException({
        code: 'SHIPMENT_NOT_AWB_ELIGIBLE',
        message: `Shipment is ${shipment.status}; AWB generation requires CREATED`,
      });
    }

    const req: DelhiveryAwbRequest = {
      shipmentNumber: shipment.shipmentNumber,
      recipientName: shipment.destRecipientName,
      recipientPhoneE164: shipment.destRecipientPhoneE164,
      addressLine1: shipment.destAddressLine1,
      addressLine2: shipment.destAddressLine2,
      city: shipment.destCity,
      stateProvince: shipment.destStateProvince,
      postalCode: shipment.destPostalCode,
      countryCode: shipment.destCountryCode,
      totalWeightGrams: shipment.totalWeightGrams,
      declaredValueInr: shipment.declaredValueInr.toString(),
      codAmountInr: shipment.codAmountInr?.toString() ?? null,
      itemDescription: shipment.items
        .map((i) => `${i.productName} x${i.quantity}`)
        .join('; '),
    };

    const awb = await this.delhiveryAwb.generateAwb(req);
    if (!awb.ok) {
      this.logger.warn(
        { shipmentId, errorCode: awb.errorCode, serviceable: awb.serviceable },
        'AWB generation failed',
      );
      return {
        status: 'FAILED',
        shipmentId,
        serviceable: awb.serviceable,
        errorCode: awb.errorCode,
        errorMessage: awb.errorMessage,
      };
    }

    // CUR-6: fetch the label + persist to OUR Spaces.
    const label = await this.delhiveryLabel.fetchLabel(awb.awbNumber);
    const labelVersion = await this.nextLabelVersion(shipmentId);
    const spacesKey = `awb-labels/${shipmentId}/v${labelVersion}-${awb.awbNumber}.pdf`;
    await this.spaces.putObject(spacesKey, label.bytes, label.mimeType);

    const now = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      // Demote any prior current label for this shipment.
      if (labelVersion > 1) {
        await tx.awbLabel.updateMany({
          where: { shipmentId, isCurrent: true },
          data: { isCurrent: false },
        });
      }
      await tx.shipment.update({
        where: { id: shipmentId },
        data: {
          awbNumber: awb.awbNumber,
          courierShipmentId: awb.courierShipmentId,
          awbGeneratedAt: now,
          status: ShipmentStatus.AWB_GENERATED,
        },
      });
      await tx.awbLabel.create({
        data: {
          shipmentId,
          version: labelVersion,
          isCurrent: true,
          spacesKey,
          spacesBucket: this.env.spacesBucket,
          mimeType: label.mimeType,
          generatedByStaffId: actor.id ?? null,
          generatedReason:
            labelVersion > 1
              ? LabelGenerationReason.AWB_REISSUED
              : LabelGenerationReason.INITIAL,
        },
      });
      await this.audit.log(
        {
          actorType: actor.type,
          actorId: actor.id ?? null,
          action: 'awb.generated',
          entityType: 'shipment',
          entityId: shipmentId,
          severity: 'LOW',
          metadata: {
            awbNumber: awb.awbNumber,
            courierShipmentId: awb.courierShipmentId,
            labelVersion,
            labelSpacesKey: spacesKey,
          },
        },
        tx,
      );
    });

    return {
      status: 'GENERATED',
      shipmentId,
      awbNumber: awb.awbNumber,
      courierShipmentId: awb.courierShipmentId,
      labelSpacesKey: spacesKey,
      labelVersion,
    };
  }

  /** Next awb_labels.version for a shipment (1 when none exists). */
  private async nextLabelVersion(shipmentId: string): Promise<number> {
    const latest = await this.prisma.client.awbLabel.findFirst({
      where: { shipmentId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (latest?.version ?? 0) + 1;
  }
}
