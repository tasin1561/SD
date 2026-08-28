import { BadRequestException, Injectable } from '@nestjs/common';
import { ActorType, ShipmentStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientInfoPayload } from '../../../common/decorators/client-info.decorator';
import {
  DelhiveryEwaybillService,
  EWAYBILL_THRESHOLD_INR,
} from '../../courier-delhivery/services/delhivery-ewaybill.service';
import { type NdrAction } from '../../courier-delhivery/services/delhivery-ndr.service';
import { CourierNdrDispatchService } from './courier-ndr-dispatch.service';
import { CourierOpsDispatchService } from './courier-ops-dispatch.service';
import { ShipmentCourierContextService } from './shipment-courier-context.service';
import { courierActor } from '../../courier-shared/services/courier-credential.service';

export interface ActionOutcome {
  readonly success: boolean;
  readonly awbNumber: string;
  readonly message: string | null;
}

/**
 * Shiprocket refuses an NDR action with no comment, and the comment is
 * read aloud to the field executive. Delhivery has no field for it, so
 * it costs nothing there and is recorded in our audit either way.
 * A per-action operator note is the obvious next step; until the UI
 * asks for one, saying what actually happened beats an empty string.
 */
const NDR_DEFAULT_COMMENT = 'Re-attempt requested by Skydrop operations';

export interface NdrOutcome extends ActionOutcome {
  /** Delhivery's async job id — the outcome is polled with it, not returned. */
  readonly uplId: string | null;
  readonly nslCode: string | null;
  readonly attemptCount: number;
}

export interface NdrReadiness {
  readonly eligible: boolean;
  readonly reason: string | null;
  readonly nslCode: string | null;
  readonly attemptCount: number;
}

/**
 * The physical-world courier actions, taken against one of OUR shipments.
 *
 * ── OPERATOR-TRIGGERED, NOT AUTOMATIC ────────────────────────────────
 * None of these fires off a lifecycle transition. That is deliberate:
 * every one has an effect out in the world that cannot be rolled back by
 * a database transaction — a cancel turns a moving parcel into a return,
 * an NDR re-attempt sends a van. The Delhivery wire contract is also not
 * yet validated against a real write (there is no sandbox on this
 * account), so a bug here spends real money rather than failing a test.
 *
 * Every one is therefore behind `DelhiveryWriteGuardService` (default
 * OFF, inside the adapter) AND behind an explicit operator action, and
 * every one writes an audit row naming who did it. When the contract has
 * been proven with a controlled parcel, automating the safe ones — an
 * NDR sweep after 21:00 IST, say — becomes a reasonable next step. Doing
 * it before then would be automating an unproven call.
 *
 * ── WE DO NOT MIRROR THE COURIER'S STATE ─────────────────────────────
 * A successful cancel does NOT transition our order. Delhivery's own
 * scans come back through the M10 webhook processor and move the order
 * through the state machine the same way every other status change
 * happens (ORD-3). Writing the transition here as well would give the
 * order two authorities that can disagree, and the webhook is the one
 * that reflects physical reality.
 */
@Injectable()
export class CourierShipmentActionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly context: ShipmentCourierContextService,
    private readonly opsDispatch: CourierOpsDispatchService,
    private readonly ewaybill: DelhiveryEwaybillService,
    private readonly ndr: CourierNdrDispatchService,
  ) {}

  /**
   * Correct the destination on a live consignment.
   *
   * Delhivery accepts edits only in a narrow set of statuses and refuses
   * anything dispatched or terminal; that check lives in the adapter,
   * which knows the wire rules. What we add here is the audit trail —
   * "who changed this customer's address, and to what" is a question
   * that gets asked after a parcel goes missing.
   */
  async editDestination(
    staffId: string,
    shipmentId: string,
    changes: {
      name?: string;
      phone?: string;
      address?: string;
      productsDesc?: string;
    },
    ctx: ClientInfoPayload,
  ): Promise<ActionOutcome> {
    const shipment = await this.requireAwb(shipmentId);
    if (Object.values(changes).every((v) => v === undefined)) {
      throw new BadRequestException({
        code: 'NO_CHANGES_SUPPLIED',
        message: 'Supply at least one field to change.',
      });
    }

    const result = await this.opsDispatch.edit(
      {
        courierCode: shipment.courierCode,
        courierAccountId: shipment.courierAccountId,
        courierShipmentId: shipment.courierShipmentId,
        awbNumber: shipment.awbNumber,
        ...changes,
      },
      courierActor.operator(staffId),
    );

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'courier.shipment.edited',
      entityType: 'shipment',
      entityId: shipment.shipmentId,
      severity: 'MEDIUM',
      metadata: {
        awbNumber: shipment.awbNumber,
        // Field NAMES only for the recipient block — the values are the
        // customer's PII and an audit row is not the place for it.
        fieldsChanged: Object.keys(changes).filter(
          (k) => changes[k as keyof typeof changes] !== undefined,
        ),
        success: result.success,
        courierMessage: result.message,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        requestId: ctx.requestId ?? null,
      },
    });

    return {
      success: result.success,
      awbNumber: shipment.awbNumber,
      message: result.message,
    };
  }

  /**
   * Ask the courier to stop carrying this parcel.
   *
   * Worth being plain about what this does NOT do: a parcel already
   * moving does not vanish, it becomes a return and comes back to us.
   * The order is untouched here — Delhivery's RTO scans drive it through
   * the state machine via the webhook processor, which is the only
   * authority on where a parcel physically is.
   */
  async cancelWithCourier(
    staffId: string,
    shipmentId: string,
    reason: string,
    ctx: ClientInfoPayload,
  ): Promise<ActionOutcome> {
    const shipment = await this.requireAwb(shipmentId);

    const result = await this.opsDispatch.cancel(
      shipment.courierCode,
      shipment.courierAccountId,
      shipment.awbNumber,
      courierActor.operator(staffId),
    );

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'courier.shipment.cancelled',
      entityType: 'shipment',
      entityId: shipment.shipmentId,
      // HIGH: a cancel on a moving parcel turns it into a return, which
      // costs a return leg and reaches the customer.
      severity: 'HIGH',
      metadata: {
        awbNumber: shipment.awbNumber,
        reason,
        success: result.success,
        courierMessage: result.message,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        requestId: ctx.requestId ?? null,
      },
    });

    return {
      success: result.success,
      awbNumber: shipment.awbNumber,
      message: result.message,
    };
  }

  /** Whether Indian law requires an e-way bill for this parcel's value. */
  async ewaybillRequirement(shipmentId: string): Promise<{
    readonly required: boolean;
    readonly declaredValueInr: string;
    readonly thresholdInr: number;
  }> {
    const shipment = await this.context.resolve(shipmentId);
    return {
      required: this.ewaybill.requiresEwaybill(Number(shipment.declaredValueInr)),
      declaredValueInr: shipment.declaredValueInr,
      thresholdInr: EWAYBILL_THRESHOLD_INR,
    };
  }

  /**
   * Attach the e-way bill number to a consignment.
   *
   * Above ₹50 000 this is a legal requirement, not a courier preference:
   * without it the goods can be detained in transit and penalised. We
   * accept the number below the threshold too — the operator may know
   * something the declared value does not say.
   */
  async attachEwaybill(
    staffId: string,
    shipmentId: string,
    input: { invoiceNumber: string; ewaybillNumber: string },
    ctx: ClientInfoPayload,
  ): Promise<ActionOutcome> {
    const shipment = await this.requireAwb(shipmentId);

    const result = await this.ewaybill.update(
      {
        awbNumber: shipment.awbNumber,
        invoiceNumber: input.invoiceNumber,
        ewaybillNumber: input.ewaybillNumber,
      },
      courierActor.operator(staffId),
    );

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'courier.shipment.ewaybill_attached',
      entityType: 'shipment',
      entityId: shipment.shipmentId,
      severity: 'MEDIUM',
      metadata: {
        awbNumber: shipment.awbNumber,
        invoiceNumber: input.invoiceNumber,
        ewaybillNumber: input.ewaybillNumber,
        declaredValueInr: shipment.declaredValueInr,
        success: result.success,
        courierMessage: result.message,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        requestId: ctx.requestId ?? null,
      },
    });

    return {
      success: result.success,
      awbNumber: shipment.awbNumber,
      message: result.message,
    };
  }

  /**
   * Can this failed delivery be re-attempted?
   *
   * Answered locally, from the NSL code the webhook processor kept and
   * the attempt count. Surfacing this BEFORE the operator clicks is the
   * whole point: Delhivery refuses an ineligible request, and a refusal
   * the operator has to decode from a raw courier message is worse than
   * a button that explains why it is disabled.
   */
  async ndrReadiness(shipmentId: string, action: NdrAction): Promise<NdrReadiness> {
    const shipment = await this.context.resolve(shipmentId);
    const { nslCode, attemptCount } = await this.latestAttempt(shipmentId);

    if (shipment.awbNumber === null) {
      return {
        eligible: false,
        reason: 'This shipment has no AWB, so the courier has nothing to re-attempt.',
        nslCode,
        attemptCount,
      };
    }

    const verdict = this.ndr.checkEligibility({
      courierCode: shipment.courierCode,
      courierAccountId: shipment.courierAccountId,
      awbNumber: shipment.awbNumber,
      action,
      currentNslCode: nslCode,
      attemptCount,
      comment: NDR_DEFAULT_COMMENT,
    });
    return { ...verdict, nslCode, attemptCount };
  }

  /**
   * Ask for a re-attempt (or a reverse-pickup reschedule).
   *
   * Returns a UPL id, NOT an outcome — Delhivery decides asynchronously.
   * Reporting this as "re-attempt booked" would tell a seller their
   * parcel is being retried when it may yet be refused, so the message
   * says what actually happened.
   *
   * Delhivery advises firing these after 21:00 IST, once the day's
   * failed parcels are physically back at the facility. We do not
   * enforce that — an operator acting on a specific customer call at
   * 3pm has a reason we should not override — but it is why a nightly
   * sweep is the better long-term shape.
   */
  async takeNdrAction(
    staffId: string,
    shipmentId: string,
    action: NdrAction,
    ctx: ClientInfoPayload,
  ): Promise<NdrOutcome> {
    const shipment = await this.requireAwb(shipmentId);
    const { nslCode, attemptCount } = await this.latestAttempt(shipmentId);

    const result = await this.ndr.takeAction(
      {
        courierCode: shipment.courierCode,
        courierAccountId: shipment.courierAccountId,
        awbNumber: shipment.awbNumber,
        action,
        currentNslCode: nslCode,
        attemptCount,
        comment: NDR_DEFAULT_COMMENT,
      },
      courierActor.operator(staffId),
    );

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'courier.shipment.ndr_action',
      entityType: 'shipment',
      entityId: shipment.shipmentId,
      severity: 'MEDIUM',
      metadata: {
        awbNumber: shipment.awbNumber,
        ndrAction: action,
        courierCode: shipment.courierCode,
        nslCode,
        attemptCount,
        uplId: result.uplId,
        success: result.success,
        courierMessage: result.message,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        requestId: ctx.requestId ?? null,
      },
    });

    return {
      success: result.success,
      awbNumber: shipment.awbNumber,
      message: result.message,
      uplId: result.uplId,
      nslCode,
      attemptCount,
    };
  }

  // `ndrStatus` was REMOVED (2026-08-06). It wrapped
  // DelhiveryNdrService.checkStatus — which IS the UPL status poll — and
  // had no caller: no controller, no service, nothing. NdrUplPollerService
  // now owns UPL polling on a schedule and persists each outcome onto
  // ndr_action_requests, so an operator reads the stored result rather
  // than spending a rate-limited call to re-ask Delhivery. Keeping the
  // operator-facing duplicate would have left two paths to one answer,
  // one live and one dead, and the next person would pick whichever they
  // found first.

  // ── internal ────────────────────────────────────────────────────────

  private async requireAwb(shipmentId: string): Promise<{
    shipmentId: string;
    awbNumber: string;
    declaredValueInr: string;
    // Who actually has the parcel — required now that a second courier
    // exists and the two are addressed differently.
    courierCode: string;
    courierAccountId: string | null;
    courierShipmentId: string | null;
  }> {
    const shipment = await this.context.resolve(shipmentId);
    if (shipment.awbNumber === null) {
      throw new BadRequestException({
        code: 'SHIPMENT_HAS_NO_AWB',
        message: 'This shipment has no AWB, so there is nothing at the courier to act on.',
      });
    }
    if (shipment.isManualCourier) {
      throw new BadRequestException({
        code: 'MANUAL_COURIER_SHIPMENT',
        message:
          'This parcel was placed manually with a non-integrated courier. Arrange the change directly with them.',
      });
    }
    if (shipment.status === ShipmentStatus.CANCELLED) {
      throw new BadRequestException({
        code: 'SHIPMENT_CANCELLED',
        message: 'This shipment is already cancelled.',
      });
    }
    return {
      shipmentId: shipment.shipmentId,
      awbNumber: shipment.awbNumber,
      courierCode: shipment.courierCode,
      courierAccountId: shipment.courierAccountId,
      courierShipmentId: shipment.courierShipmentId,
      declaredValueInr: shipment.declaredValueInr,
    };
  }

  /**
   * The current failure reason and how many attempts have been made.
   *
   * `attemptNumber` is the authority rather than a row count: the column
   * is assigned under an advisory lock at write time (M10), so it stays
   * correct even if a row were ever removed.
   */
  private async latestAttempt(
    shipmentId: string,
  ): Promise<{ nslCode: string | null; attemptCount: number }> {
    const latest = await this.prisma.client.deliveryAttempt.findFirst({
      where: { shipmentId },
      orderBy: { attemptNumber: 'desc' },
      select: { courierNslCode: true, attemptNumber: true },
    });
    return {
      nslCode: latest?.courierNslCode ?? null,
      attemptCount: latest?.attemptNumber ?? 0,
    };
  }
}
