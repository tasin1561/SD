import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  CredentialEnvironment,
  LabelGenerationReason,
  ShipmentStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../../config/env.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CourierAccountRoutingService } from '../../courier-shared/services/courier-account-routing.service';
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
      /**
       * M10 commit 1 (resolves the M9 real-mode label-upload-ordering
       * debt): the AWB has been DURABLY PERSISTED on the shipment
       * (`awbNumber` set, status=AWB_GENERATED, audit `awb.generated`
       * written) but the label fetch / Spaces upload / awb_labels row
       * insert failed. The caller (AWB job) MUST treat this as a
       * retryable failure — throw to BullMQ so the whole job re-runs
       * and the CUR-9 recovery path re-attempts ONLY the label leg
       * (no second Delhivery `generateAwb` call → no double real AWB
       * / double charge in real mode).
       */
      status: 'GENERATED_AWB_LABEL_PENDING';
      shipmentId: string;
      awbNumber: string;
      courierShipmentId: string;
      errorMessage: string;
    }
  | {
      /** CUR-9 idempotent skip — the shipment already carries an AWB
       *  AND a current awb_label row (truly complete). */
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
 * Module 9 — per-shipment AWB generation (CUR-6 + CUR-9). M10 commit 1
 * applied the visible-vs-silent / source-of-truth-first reorder that
 * resolves the M9 real-mode label-upload-ordering debt.
 *
 * ── Saga ordering (the M10-commit-1 fix) ────────────────────────────
 * The previous ordering uploaded the label to Spaces BEFORE persisting
 * `awbNumber`, in one transaction. Real-mode bug: if Spaces.putObject
 * failed AFTER Delhivery had already issued a real AWB, the AWB was
 * generated-but-unpersisted (`awbNumber === null`), the CUR-9
 * idempotency gate missed it, and a BullMQ retry called `generateAwb`
 * AGAIN — a SECOND real AWB + a second courier charge for one parcel.
 * Inert in Phase 1A (stub Delhivery, dev/test Spaces never fails) but
 * a real-mode footgun.
 *
 * The fix: split the cross-module side-effects so the durable
 * source-of-truth (the AWB, which cost a real API call) lands FIRST
 * and a half-finished run is SELF-ANNOUNCING (visible, recoverable),
 * never silent (mirrors the WMS-8 / CUR-3 / RTO-finalize family — see
 * "Saga: visible-vs-silent failure ordering" in CLAUDE.md).
 *
 *   Phase A — eligibility + CUR-9 gates
 *     • shipment.awbNumber !== null + a current awb_label row exists
 *       → ALREADY_HAS_AWB (truly complete, idempotent no-op).
 *     • shipment.awbNumber !== null + NO current awb_label row
 *       → RECOVERY PATH: skip Delhivery (CUR-9 honored — exactly the
 *       case the old ordering's retry would have re-charged on), run
 *       Phase C only against the persisted AWB.
 *     • shipment.awbNumber === null but status !== CREATED → 409.
 *
 *   Phase B — Delhivery `generateAwb`. On failure → return FAILED, NO
 *     DB write (the AWB job's caller owns the supersede + order-status
 *     routing).
 *
 *   Phase C — tx1 (THE source-of-truth write): stamp the shipment
 *     (`awbNumber` / `courierShipmentId` / `awbGeneratedAt` / status
 *     `AWB_GENERATED`) + audit `awb.generated`. From this commit on,
 *     a BullMQ retry CANNOT re-call `generateAwb` (CUR-9 gate fires).
 *
 *   Phase D — label fetch (DelhiveryLabelService) + Spaces upload
 *     (CUR-6) + tx2: insert the `awb_labels` row (versioned,
 *     isCurrent; a prior current label, if any, is demoted) + audit
 *     `awb.label_persisted`. On ANY failure in this phase → return
 *     `GENERATED_AWB_LABEL_PENDING`. The job service throws on that
 *     outcome so BullMQ retries the whole job; on retry the Phase-A
 *     recovery path skips Phase B+C entirely and re-runs only Phase D.
 *
 * Shipment-grained: operates on a shipmentId; CUR-9 idempotency keyed
 * on shipment.awbNumber. Split-shipment orders correct by construction.
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
    private readonly courierAccountRouting: CourierAccountRoutingService,
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
        courierShipmentId: true,
        courierCode: true,
        status: true,
        orderShipments: {
          select: { order: { select: { sellerId: true } } },
          orderBy: { shipmentSequence: 'asc' },
          take: 1,
        },
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
        // CUR-9 gate enrichment (M10 commit 1): the gate now considers
        // "awbNumber set + current label persisted" the truly-complete
        // state; "awbNumber set + no current label" routes to the
        // Phase-D recovery path instead of being treated as complete.
        awbLabels: {
          where: { isCurrent: true },
          select: { id: true },
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

    // Phase A — CUR-9 gates.
    if (shipment.awbNumber !== null) {
      if (shipment.awbLabels.length > 0) {
        return {
          status: 'ALREADY_HAS_AWB',
          shipmentId,
          awbNumber: shipment.awbNumber,
        };
      }
      // Recovery path: AWB was persisted by a prior attempt; the label
      // leg failed. Skip Delhivery (NO second `generateAwb` — the whole
      // point of the M10 commit 1 reorder) and re-run Phase D only.
      // courierShipmentId was also persisted in the prior Phase C; if
      // somehow null (data anomaly), fall back to empty for the outcome
      // — the shipment row is the source of truth either way.
      this.logger.log(
        { shipmentId, awbNumber: shipment.awbNumber },
        'AWB persisted from prior attempt; running label recovery (Phase D)',
      );
      return this.uploadAndPersistLabel(
        shipmentId,
        shipment.awbNumber,
        shipment.courierShipmentId ?? '',
        actor,
      );
    }

    if (shipment.status !== ShipmentStatus.CREATED) {
      throw new ConflictException({
        code: 'SHIPMENT_NOT_AWB_ELIGIBLE',
        message: `Shipment is ${shipment.status}; AWB generation requires CREATED`,
      });
    }

    // Phase B — Delhivery generateAwb.
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
      itemDescription: shipment.items.map((i) => `${i.productName} x${i.quantity}`).join('; '),
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

    // R1 (revised-plan roadmap): best-effort account resolution for
    // traceability. Phase 1A seeds NO CourierAccount rows at all, so
    // this MUST NEVER block AWB generation — it only opportunistically
    // populates courierAccountId once accounts + seller links exist.
    // The actual credential/HTTP auth path is untouched (still the
    // legacy per-courier getCredential — real mode is unvalidated
    // regardless, see CLAUDE.md CUR TODO(delhivery-api) seams).
    const courierAccountId = await this.resolveCourierAccountId(shipment);

    // Phase C — tx1: durable source-of-truth FIRST. Once this commits,
    // the AWB exists on the shipment row; CUR-9 will fire on any retry.
    const generatedAt = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id: shipmentId },
        data: {
          awbNumber: awb.awbNumber,
          courierShipmentId: awb.courierShipmentId,
          awbGeneratedAt: generatedAt,
          // The status is deliberately NOT advanced here.
          //
          // Since the AWB is generated at order CONFIRMATION, the parcel
          // still has to be picked and packed — and both queues select
          // on `status = 'created'` (WMS-2). Marking it AWB_GENERATED
          // took the shipment straight out of the warehouse flow: the
          // pick 409'd and the box could never be packed.
          //
          // `awbNumber` is the authoritative "this has an AWB" fact
          // (CUR-9), not the status, so nothing is lost. ShipmentStatus
          // tracks where the parcel physically IS; a label existing does
          // not move it. It advances to HANDED_TO_COURIER when the
          // parcel is actually handed over.
          ...(courierAccountId === null ? {} : { courierAccountId }),
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
          },
        },
        tx,
      );
    });

    // Phase D — label fetch + Spaces upload + tx2 (retryable follow-on).
    return this.uploadAndPersistLabel(shipmentId, awb.awbNumber, awb.courierShipmentId, actor);
  }

  /**
   * Phase D — fetch the label, upload to Spaces, persist the awb_labels
   * row. Catches every failure into `GENERATED_AWB_LABEL_PENDING` so the
   * AWB-already-persisted fact is preserved and the caller can drive a
   * retry (BullMQ). Versioning + isCurrent demotion handles the
   * re-issue case (CUR-6) AND the recovery path (a prior failed attempt
   * left no current row → version 1 isCurrent).
   */
  private async uploadAndPersistLabel(
    shipmentId: string,
    awbNumber: string,
    courierShipmentId: string,
    actor: { type: ActorType; id?: string | null },
  ): Promise<AwbGenerationOutcome> {
    try {
      const label = await this.delhiveryLabel.fetchLabel(awbNumber);
      const labelVersion = await this.nextLabelVersion(shipmentId);
      const spacesKey = `awb-labels/${shipmentId}/v${labelVersion}-${awbNumber}.pdf`;
      await this.spaces.putObject(spacesKey, label.bytes, label.mimeType);

      await this.prisma.client.$transaction(async (tx) => {
        // Demote any prior current label for this shipment (re-issue
        // path). A first label / recovery-after-zero-prior-labels case
        // is a no-op updateMany.
        if (labelVersion > 1) {
          await tx.awbLabel.updateMany({
            where: { shipmentId, isCurrent: true },
            data: { isCurrent: false },
          });
        }
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
              labelVersion > 1 ? LabelGenerationReason.AWB_REISSUED : LabelGenerationReason.INITIAL,
          },
        });
        await this.audit.log(
          {
            actorType: actor.type,
            actorId: actor.id ?? null,
            action: 'awb.label_persisted',
            entityType: 'shipment',
            entityId: shipmentId,
            severity: 'LOW',
            metadata: {
              awbNumber,
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
        awbNumber,
        courierShipmentId,
        labelSpacesKey: spacesKey,
        labelVersion,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { shipmentId, awbNumber, err: errorMessage },
        'AWB label upload failed — AWB is durable, label leg will retry',
      );
      return {
        status: 'GENERATED_AWB_LABEL_PENDING',
        shipmentId,
        awbNumber,
        courierShipmentId,
        errorMessage,
      };
    }
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

  /**
   * R1 — best-effort CourierAccount resolution for traceability only.
   * Returns `null` (never throws) whenever the seller/courier can't be
   * resolved or `CourierAccountRoutingService.selectAccount` has
   * nothing to offer (NO_COURIER_ACCOUNT_AVAILABLE is the Phase-1A norm
   * — no accounts are seeded yet). This is deliberately decoupled from
   * the actual credential/HTTP auth path (still `getCredential` via
   * DelhiveryHttpService) — wiring THAT through per-account credentials
   * is a separate follow-up once real mode is validated.
   */
  private async resolveCourierAccountId(shipment: {
    courierCode: string;
    orderShipments: readonly { order: { sellerId: string } }[];
  }): Promise<string | null> {
    const sellerId = shipment.orderShipments[0]?.order.sellerId;
    if (sellerId === undefined) return null;
    try {
      const courier = await this.prisma.client.courier.findUnique({
        where: { code: shipment.courierCode },
        select: { id: true },
      });
      if (!courier) return null;
      const environment = this.env.isProduction
        ? CredentialEnvironment.PRODUCTION
        : CredentialEnvironment.SANDBOX;
      const selected = await this.courierAccountRouting.selectAccount(
        sellerId,
        courier.id,
        environment,
      );
      return selected.courierAccountId;
    } catch (err) {
      this.logger.debug(
        {
          sellerId,
          courierCode: shipment.courierCode,
          err: err instanceof Error ? err.message : String(err),
        },
        'No courier account resolved for this shipment (expected until accounts are configured) — courierAccountId left unset',
      );
      return null;
    }
  }
}
