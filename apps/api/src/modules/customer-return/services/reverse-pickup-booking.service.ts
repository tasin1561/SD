import { Injectable, Logger } from '@nestjs/common';
import { ActorType, SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import {
  CourierAwbDispatchService,
  type DispatchAwbInput,
} from '../../courier-awb/services/courier-awb-dispatch.service';
import { courierActor } from '../../courier-shared/services/courier-credential.service';

export interface BookReversePickupResult {
  readonly booked: boolean;
  readonly awbNumber: string | null;
  /** Already had one — a retry, not a second van. */
  readonly alreadyBooked: boolean;
  readonly message: string | null;
}

/**
 * Ask the courier to collect a parcel back from the customer.
 *
 * ── THIS SENDS A VAN ─────────────────────────────────────────────────
 * Delhivery books a reverse as a NEW shipment with `payment_mode:
 * 'Pickup'`, and schedules the collection itself — so unlike a forward
 * parcel there is no second call, and no undo beyond a cancel. It is a
 * real, physical, chargeable action taken on the strength of one click.
 *
 * ── THE CLAIM COMES BEFORE THE CALL ──────────────────────────────────
 * `reverseAwbRequestedAt` is taken with a guarded `updateMany` BEFORE
 * the courier is contacted, and is NOT cleared when the booking fails.
 * That is deliberate and it is the same reasoning as the pickup-request
 * day-slot: we cannot tell "they never received it" from "their reply
 * was lost", and the two failures want opposite responses. Freeing the
 * claim would let a retry book a second collection for the same parcel
 * — two vans, two charges, and a customer asked twice.
 *
 * So a failure stops here and asks for a person. The error is recorded
 * on the shipment and raised on the issues board; whoever looks can
 * clear the claim deliberately once they know which of the two happened.
 *
 * ── THE ADDRESSES ARE NOT SWAPPED ────────────────────────────────────
 * On a reverse leg the recipient fields are where the parcel is
 * COLLECTED — the customer — and the account's pickup location is where
 * it goes. That is the adapter's contract, so the snapshot is passed
 * through exactly as it is for a forward booking.
 */
@Injectable()
export class ReversePickupBookingService {
  private readonly logger = new Logger(ReversePickupBookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: CourierAwbDispatchService,
    private readonly audit: AuditLogService,
    private readonly issues: SystemIssueService,
  ) {}

  async book(input: {
    orderId: string;
    sellerId: string;
    /** Who asked. A seller may return their own parcel; staff may too. */
    actor: { type: ActorType; staffId?: string | null };
  }): Promise<BookReversePickupResult> {
    const link = await this.prisma.client.orderShipment.findFirst({
      where: { orderId: input.orderId, shipment: { deletedAt: null, supersededAt: null } },
      orderBy: { shipmentSequence: 'desc' },
      select: {
        shipment: {
          select: {
            id: true,
            shipmentNumber: true,
            courierCode: true,
            courierAccountId: true,
            reverseAwbNumber: true,
            reverseAwbRequestedAt: true,
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
            lengthCm: true,
            widthCm: true,
            heightCm: true,
          },
        },
      },
    });
    const s = link?.shipment;
    if (s === undefined || s === null) {
      return {
        booked: false,
        awbNumber: null,
        alreadyBooked: false,
        message: 'This order has no live parcel to collect.',
      };
    }
    if (s.reverseAwbNumber !== null) {
      return {
        booked: true,
        awbNumber: s.reverseAwbNumber,
        alreadyBooked: true,
        message: null,
      };
    }
    if (s.courierAccountId === null) {
      return {
        booked: false,
        awbNumber: null,
        alreadyBooked: false,
        message: 'This parcel has no courier account recorded, so we cannot book against one.',
      };
    }

    // ── CLAIM ──────────────────────────────────────────────────────
    // Guarded, not read-then-write: two operators clicking at once must
    // not produce two collections.
    const claimed = await this.prisma.client.shipment.updateMany({
      where: { id: s.id, reverseAwbRequestedAt: null, reverseAwbNumber: null },
      data: { reverseAwbRequestedAt: new Date() },
    });
    if (claimed.count === 0) {
      return {
        booked: false,
        awbNumber: null,
        alreadyBooked: true,
        message:
          'A collection has already been asked for on this parcel. If it did not go through, someone needs to check with the courier before asking again.',
      };
    }

    const req: DispatchAwbInput = {
      isReverse: true,
      courierCode: s.courierCode,
      courierAccountId: s.courierAccountId,
      shipmentId: s.id,
      // Their own reference, marked so a reverse is recognisable in
      // their panel without cross-referencing ours.
      shipmentNumber: `${s.shipmentNumber}-RVP`,
      orderNumber: s.shipmentNumber,
      pickupLocationName: '',
      recipientName: s.destRecipientName,
      recipientPhoneE164: s.destRecipientPhoneE164,
      addressLine1: s.destAddressLine1,
      addressLine2: s.destAddressLine2 ?? '',
      city: s.destCity,
      stateProvince: s.destStateProvince,
      postalCode: s.destPostalCode,
      countryCode: s.destCountryCode,
      totalWeightGrams: s.totalWeightGrams ?? 0,
      // The parcel that went out is the parcel coming back.
      lengthCm: Number(s.lengthCm ?? 0),
      breadthCm: Number(s.widthCm ?? 0),
      heightCm: Number(s.heightCm ?? 0),
      declaredValueInr: s.declaredValueInr.toString(),
      // A return collects nothing from the customer, whatever the
      // forward leg was. Sending the COD amount here would ask them to
      // pay for their own return.
      codAmountInr: null,
      itemDescription: 'Customer return',
      items: [],
    };

    try {
      const r = await this.dispatch.generate(req, courierActor.operator(input.actor.staffId ?? ''));
      if (!r.ok || r.awbNumber === null) {
        await this.recordFailure(s.id, input, r.errorMessage ?? 'The courier refused the booking.');
        return {
          booked: false,
          awbNumber: null,
          alreadyBooked: false,
          message: r.errorMessage ?? 'The courier refused the booking.',
        };
      }

      // Persist the waybill IMMEDIATELY — it is the only record that a
      // real collection now exists, and everything downstream (the
      // tracking poll, the cancel, the cost) is addressed from it.
      await this.prisma.client.shipment.update({
        where: { id: s.id },
        data: {
          reverseAwbNumber: r.awbNumber,
          reverseAwbGeneratedAt: new Date(),
          reverseCourierShipmentId: r.courierShipmentId,
          reverseAwbError: null,
        },
      });

      await this.audit.log({
        actorType: input.actor.type,
        staffUserId: input.actor.staffId ?? null,
        sellerId: input.actor.type === ActorType.SELLER ? input.sellerId : null,
        action: 'courier.reverse_pickup.booked',
        entityType: 'shipment',
        entityId: s.id,
        // HIGH: a van is now coming to a customer's door.
        severity: 'HIGH',
        metadata: { orderId: input.orderId, awbNumber: r.awbNumber, courierCode: s.courierCode },
      });

      return { booked: true, awbNumber: r.awbNumber, alreadyBooked: false, message: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.recordFailure(s.id, input, message);
      return { booked: false, awbNumber: null, alreadyBooked: false, message };
    }
  }

  /**
   * The claim STAYS. Recorded where a human will see it, because only a
   * human can tell a refusal from a lost reply, and only one of those is
   * safe to retry.
   */
  private async recordFailure(
    shipmentId: string,
    input: { orderId: string; sellerId: string },
    message: string,
  ): Promise<void> {
    await this.prisma.client.shipment
      .update({ where: { id: shipmentId }, data: { reverseAwbError: message.slice(0, 500) } })
      .catch(() => undefined);

    this.logger.error({ shipmentId, orderId: input.orderId, message }, 'Reverse pickup failed');

    await this.issues.raise({
      kind: SystemIssueKind.INTEGRATION,
      severity: SystemIssueSeverity.HIGH,
      title: 'A customer return was accepted but the collection was not booked',
      detail:
        `The courier did not book a pickup for order ${input.orderId}: ${message}\n\n` +
        'The order is already marked as returning and the seller has been told, so the goods ' +
        'are sitting with a customer nobody is coming for. Book it by hand in the courier ' +
        'portal, or clear the claim on the parcel so it can be retried — but establish which ' +
        'happened first: a refusal is safe to retry, a lost reply is a second van.',
      source: 'ReversePickupBookingService',
      dedupeKey: `reverse-pickup-failed:${shipmentId}`,
      metadata: { shipmentId, orderId: input.orderId, sellerId: input.sellerId, error: message },
    });
  }
}
