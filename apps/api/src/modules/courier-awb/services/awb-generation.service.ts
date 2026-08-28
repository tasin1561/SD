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
import { PaymentMode, Prisma } from '@skydrop/db';
import { CourierAwbDispatchService } from './courier-awb-dispatch.service';
import { CourierDistributionService } from '../../courier-shared/services/courier-distribution.service';
import type { DelhiveryAwbRequest } from '../../courier-delhivery/types/delhivery.types';
import { courierActor } from '../../courier-shared/services/courier-credential.service';

export type AwbGenerationOutcome =
  | {
      status: 'GENERATED';
      shipmentId: string;
      awbNumber: string;
      courierShipmentId: string | null;
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
      courierShipmentId: string | null;
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
      /** false ⇒ the courier rejected the destination as
       *  non-serviceable (CUR-5) AND no alternate courier would take it
       *  either — the caller (AWB job) auto-supersedes → manual
       *  placement. true ⇒ a transient failure; retry, do not derail. */
      serviceable: boolean;
      errorCode: string | null;
      errorMessage: string | null;
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
    private readonly dispatch: CourierAwbDispatchService,
    private readonly distribution: CourierDistributionService,
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
        courierAccountId: true,
        courierCode: true,
        status: true,
        orderShipments: {
          select: {
            order: {
              select: { sellerId: true, orderNumber: true, paymentMode: true },
            },
          },
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
        // Shiprocket wants the box; Delhivery does not ask. Selected
        // once so the dispatcher can serve either.
        originWarehouseId: true,
        lengthCm: true,
        widthCm: true,
        heightCm: true,
        codAmountInr: true,
        items: {
          // Shiprocket itemises the order; Delhivery takes one string.
          // Selected once, used by whichever adapter answers.
          select: {
            productName: true,
            quantity: true,
            skuCode: true,
            unitPriceInr: true,
          },
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
        shipment.courierShipmentId,
        // The row already records who took it — the recovery path is
        // resuming a parcel somebody else may have accepted.
        shipment.courierCode,
        shipment.courierAccountId ?? '',
        actor,
      );
    }

    if (shipment.status !== ShipmentStatus.CREATED) {
      throw new ConflictException({
        code: 'SHIPMENT_NOT_AWB_ELIGIBLE',
        message: `Shipment is ${shipment.status}; AWB generation requires CREATED`,
      });
    }

    // WHICH ACCOUNT — resolved BEFORE the call, because it decides the
    // token the call authenticates with and the pickup location it
    // sends. It used to be resolved after, when it could only be
    // recorded; a shipment stamped with account B while created under
    // account A's credential is worse than an untraceable one, because
    // the margin report and the settlement matching then agree with each
    // other and with nothing real.
    //
    // Still never throws: with no accounts configured this is null and
    // everything resolves exactly as it does today.
    const courierAccountId = await this.resolveCourierAccountId(shipment);

    // Phase B — Delhivery generateAwb.
    const req: DelhiveryAwbRequest = {
      shipmentNumber: shipment.shipmentNumber,
      recipientName: shipment.destRecipientName,
      recipientPhoneE164: shipment.destRecipientPhoneE164,
      addressLine1: shipment.destAddressLine1,
      addressLine2: shipment.destAddressLine2 ?? '',
      city: shipment.destCity,
      stateProvince: shipment.destStateProvince,
      postalCode: shipment.destPostalCode,
      countryCode: shipment.destCountryCode,
      totalWeightGrams: shipment.totalWeightGrams,
      declaredValueInr: shipment.declaredValueInr.toString(),
      codAmountInr: shipment.codAmountInr?.toString() ?? null,
      // Comma, not semicolon: ';' is on Delhivery's rejected-character
      // list, so a two-item order would have failed with their generic
      // internal error and nothing pointing at the separator. The
      // sanitiser in the adapter is the backstop; this is not writing
      // the problem in the first place.
      itemDescription: shipment.items.map((i) => `${i.productName} x${i.quantity}`).join(', '),
    };

    const runner = courierActor.runner('awb-generation', shipmentId);
    const sellerId = shipment.orderShipments[0]?.order.sellerId ?? null;

    const dispatchInput = {
      courierCode: shipment.courierCode,
      courierAccountId: courierAccountId ?? '',
      shipmentId,
      shipmentNumber: shipment.shipmentNumber,
      orderNumber: shipment.orderShipments[0]?.order.orderNumber ?? shipment.shipmentNumber,
      // Their pickup locations are registered by NAME and matched
      // exactly (the same rule courier-ops warns about for Delhivery
      // warehouse registration).
      pickupLocationName: shipment.originWarehouseId,
      recipientName: shipment.destRecipientName,
      recipientPhoneE164: shipment.destRecipientPhoneE164,
      addressLine1: shipment.destAddressLine1,
      addressLine2: shipment.destAddressLine2 ?? '',
      city: shipment.destCity,
      stateProvince: shipment.destStateProvince,
      postalCode: shipment.destPostalCode,
      countryCode: shipment.destCountryCode,
      totalWeightGrams: shipment.totalWeightGrams,
      declaredValueInr: shipment.declaredValueInr.toString(),
      codAmountInr: shipment.codAmountInr?.toString() ?? null,
      itemDescription: req.itemDescription,
      items: shipment.items.map((i) => ({
        name: i.productName,
        sku: i.skuCode,
        quantity: i.quantity,
        unitPriceInr: Number(i.unitPriceInr ?? 0),
      })),
      // Their API requires dimensions and refuses a zero. A parcel
      // whose box was never measured gets a modest default rather than
      // a refusal — the weight is what they actually price on, and a
      // missing measurement should not strand a real parcel.
      lengthCm: Number(shipment.lengthCm ?? 10),
      breadthCm: Number(shipment.widthCm ?? 10),
      heightCm: Number(shipment.heightCm ?? 10),
    };

    let dispatched = await this.dispatch.generate(dispatchInput, runner);
    // Whichever courier ends up carrying it — starts as the one the
    // shipment was provisioned with and changes only on a successful
    // failover.
    let carriedBy = { courierCode: shipment.courierCode, courierAccountId };

    // ── FAILOVER ─────────────────────────────────────────────────────
    //
    // Only on a REFUSAL. A courier saying "I do not serve that pincode"
    // is a fact about its network, and another courier may well serve
    // it — leaving the parcel for a person to place by hand when a
    // second integration would have taken it is the waste this exists
    // to remove.
    //
    // NOT on a timeout or a 500. Those resolve on their own, the AWB job
    // already retries them (CUR-2b), and failing over on a thirty-second
    // wobble would silently move volume — and cost — to a different
    // courier because one API had a bad minute. If the retries are
    // exhausted the parcel still ends up in manual placement, which is
    // where it would have gone anyway.
    //
    // A different COURIER, never merely a different account: a second
    // Delhivery account refuses the same pincode for the same reason.
    if (!dispatched.ok && !dispatched.serviceable && sellerId !== null) {
      const alternate = await this.alternateAccount(shipment, sellerId);
      if (alternate !== null) {
        this.logger.log(
          {
            shipmentId,
            refusedBy: shipment.courierCode,
            tryingInstead: alternate.courierCode,
            reason: dispatched.errorMessage,
          },
          'Courier refused the parcel; trying another',
        );
        const second = await this.dispatch.generate(
          {
            ...dispatchInput,
            courierCode: alternate.courierCode,
            courierAccountId: alternate.courierAccountId,
          },
          runner,
        );
        if (second.ok) {
          dispatched = second;
          carriedBy = {
            courierCode: alternate.courierCode,
            courierAccountId: alternate.courierAccountId,
          };
        } else {
          // Both refused. Keep the FIRST courier's reason — it is the
          // one that answers "why is this in manual placement", and the
          // alternate's message is about a courier nobody chose.
          this.logger.warn(
            { shipmentId, alternate: alternate.courierCode, reason: second.errorMessage },
            'The alternate courier refused it too; routing to manual placement',
          );
        }
      }
    }

    const awb = dispatched.ok
      ? {
          ok: true as const,
          awbNumber: dispatched.awbNumber ?? '',
          // Preserved: Shiprocket's own parcel id, which its label,
          // pickup and cancel endpoints key on. Null for Delhivery,
          // whose waybill is the identifier for everything after.
          courierShipmentId: dispatched.courierShipmentId,
        }
      : {
          ok: false as const,
          serviceable: dispatched.serviceable,
          errorCode: dispatched.errorCode ?? undefined,
          errorMessage: dispatched.errorMessage ?? undefined,
        };
    if (!awb.ok) {
      this.logger.warn(
        {
          shipmentId,
          errorCode: awb.errorCode,
          serviceable: awb.serviceable,
          // Delhivery's OWN words for the refusal — their `rmk` or the
          // per-package `remarks`. It was computed and then dropped,
          // which left the log saying only DELHIVERY_CREATE_FAILED: true
          // but useless, because every interesting failure here is a
          // different sentence from them. Found during the first live
          // write, where the reason was the entire thing we needed.
          errorMessage: awb.errorMessage,
        },
        'AWB generation failed',
      );
      return {
        status: 'FAILED',
        shipmentId,
        serviceable: awb.serviceable,
        errorCode: awb.errorCode ?? null,
        errorMessage: awb.errorMessage ?? null,
      };
    }

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
          // WHICHEVER courier took it, not the one we started with.
          // Miss this and every later call about this parcel — the
          // label, the tracking poll, a cancel — goes to a company that
          // has never heard of it.
          courierCode: carriedBy.courierCode,
          ...(carriedBy.courierAccountId === null
            ? {}
            : { courierAccountId: carriedBy.courierAccountId }),
          ...(dispatched.courierShipmentId === null
            ? {}
            : { courierShipmentId: dispatched.courierShipmentId }),
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
    return this.uploadAndPersistLabel(
      shipmentId,
      awb.awbNumber,
      awb.courierShipmentId,
      carriedBy.courierCode,
      carriedBy.courierAccountId ?? '',
      actor,
    );
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
    /** Shiprocket's own parcel id; null for Delhivery, whose waybill is
     *  the only identifier its label endpoint takes. */
    courierShipmentId: string | null,
    /** WHO carries it — after failover this is not necessarily the
     *  courier the shipment was originally routed to. */
    courierCode: string,
    courierAccountId: string,
    actor: { type: ActorType; id?: string | null },
  ): Promise<AwbGenerationOutcome> {
    try {
      // Whichever courier ACTUALLY carries it. Before failover this was
      // always Delhivery and the hardcoded call was harmless; the moment
      // a parcel can fail over, asking Delhivery for a Shiprocket
      // waybill's label returns nothing and the parcel ships unlabelled.
      const label = await this.dispatch.fetchLabel(
        {
          courierCode,
          courierAccountId,
          awbNumber,
          courierShipmentId,
        },
        courierActor.runner('awb-generation', shipmentId),
      );
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
   * WHICH account carries this parcel.
   *
   * This is no longer traceability — the answer decides the token the
   * create call authenticates with, the pickup location it sends, and
   * which pool its waybill comes from. It is resolved before Phase B for
   * exactly that reason.
   *
   * Returns `null` (never throws) when the seller/courier cannot be
   * resolved or `selectAccount` has nothing to offer. `null` is a real
   * answer, not a failure: with no CourierAccount rows configured —
   * which is production today — `resolveCredential` falls back to the
   * single active credential and behaviour is unchanged. What null must
   * NOT do is let a call proceed under some other account's token, which
   * is why the fallback lives in one place and refuses to guess when
   * accounts exist but none is default.
   */
  /**
   * An account on a DIFFERENT courier, for when the first one refuses.
   *
   * Never merely a different account on the same courier: a second
   * Delhivery account refuses a pincode Delhivery does not serve for
   * exactly the same reason the first did, so the retry would spend a
   * call to learn what we already know.
   *
   * Returns null when there is nowhere else to go, and the caller then
   * does what it has always done — supersede and route to a human.
   */
  private async alternateAccount(
    shipment: {
      courierCode: string;
      codAmountInr: Prisma.Decimal | null;
    },
    sellerId: string,
  ): Promise<{ courierCode: string; courierAccountId: string } | null> {
    try {
      const current = await this.prisma.client.courier.findUnique({
        where: { code: shipment.courierCode },
        select: { id: true },
      });
      if (!current) return null;
      const environment = this.env.isProduction
        ? CredentialEnvironment.PRODUCTION
        : CredentialEnvironment.SANDBOX;
      const alt = await this.distribution.pickAlternate(sellerId, {
        paymentMode:
          shipment.codAmountInr !== null && shipment.codAmountInr.greaterThan(0)
            ? PaymentMode.COD
            : PaymentMode.PREPAID,
        excludeCourierId: current.id,
        environment,
      });
      if (alt === null) return null;
      return { courierCode: alt.courierCode, courierAccountId: alt.courierAccountId };
    } catch (err) {
      // Failing to FIND an alternate must never turn a refusal into a
      // crash — the parcel still has manual placement waiting for it.
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Could not resolve an alternate courier; the parcel goes to manual placement',
      );
      return null;
    }
  }

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
