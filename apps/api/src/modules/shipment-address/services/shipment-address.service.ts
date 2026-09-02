import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ActorType, ShipmentStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CourierOpsDispatchService } from '../../courier-ops/services/courier-ops-dispatch.service';
import { courierActor } from '../../courier-shared/services/courier-credential.service';

/**
 * When the courier will still accept a correction.
 *
 * Delhivery's own rule, from the verified contract: forward parcels are
 * editable while Manifested, In Transit or Pending, and never once
 * Dispatched, Delivered, DTO, RTO, LOST or Closed.
 *
 * The mapping that matters and is easy to get wrong: their "Dispatched"
 * is OUR `OUT_FOR_DELIVERY`. A parcel on the van is already past the
 * point of changing where it is going, so that status is OUTSIDE the
 * window even though it feels like the moment you would most want it.
 */
const EDITABLE_STATUSES: ReadonlySet<ShipmentStatus> = new Set([
  ShipmentStatus.AWB_GENERATED,
  ShipmentStatus.HANDED_TO_COURIER,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.AT_HUB,
  ShipmentStatus.DELIVERY_ATTEMPTED,
]);

export interface AddressEditability {
  readonly editable: boolean;
  /** Said in the seller's terms, not the courier's. */
  readonly reason: string;
  readonly currentName: string;
  readonly currentPhone: string;
  readonly currentAddressLine1: string;
  /** Fixed for the life of the parcel — routing, not description. */
  readonly city: string;
  readonly stateProvince: string;
  readonly postalCode: string;
}

export interface AddressChangeRow {
  readonly id: string;
  readonly actorType: ActorType;
  readonly nameBefore: string | null;
  readonly nameAfter: string | null;
  readonly phoneBefore: string | null;
  readonly phoneAfter: string | null;
  readonly addressBefore: string | null;
  readonly addressAfter: string | null;
  readonly courierAcceptedAt: Date | null;
  readonly courierMessage: string | null;
  readonly verifiedAt: Date | null;
  readonly verifiedMatch: boolean | null;
  readonly verificationNote: string | null;
  readonly createdAt: Date;
}

export interface ChangeResult {
  readonly accepted: boolean;
  readonly changeId: string;
  readonly message: string | null;
}

/**
 * Correcting the consignee on a parcel that is already moving.
 *
 * ── WHAT CAN CHANGE, AND WHAT CANNOT ─────────────────────────────────
 * Name, phone and the address LINE. Not city, state or pincode: the
 * courier's edit API has no parameter for them, and it could not honour
 * one if it did — the parcel has already been sorted against that
 * pincode and is physically somewhere because of it. A "changed"
 * pincode would be a promise nothing can keep.
 *
 * ── ACCEPTED IS NOT VERIFIED ─────────────────────────────────────────
 * Their API returning success means they took the request. It does not
 * mean their record changed. The two are recorded as separate facts and
 * the portal worker goes and looks; until it has, the seller is told
 * the change was sent, not that it landed.
 */
@Injectable()
export class ShipmentAddressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ops: CourierOpsDispatchService,
    private readonly audit: AuditLogService,
  ) {}

  /** What the seller may change right now, and the current values. */
  async editability(orderId: string, sellerId: string | null): Promise<AddressEditability> {
    const s = await this.liveShipment(orderId, sellerId);
    const editable = EDITABLE_STATUSES.has(s.status);
    return {
      editable,
      reason: editable
        ? 'The courier will still accept a correction on this parcel.'
        : s.status === ShipmentStatus.OUT_FOR_DELIVERY
          ? 'It is out for delivery — once a parcel is on the van the courier will not change where it is going.'
          : `The courier does not accept changes once a parcel is ${s.status
              .toLowerCase()
              .replaceAll('_', ' ')}.`,
      currentName: s.destRecipientName,
      currentPhone: s.destRecipientPhoneE164,
      currentAddressLine1: s.destAddressLine1,
      city: s.destCity,
      stateProvince: s.destStateProvince,
      postalCode: s.destPostalCode,
    };
  }

  async change(input: {
    orderId: string;
    sellerId: string | null;
    name?: string;
    phone?: string;
    addressLine1?: string;
    actor: { type: ActorType; staffId?: string | null; sellerId?: string | null };
  }): Promise<ChangeResult> {
    const s = await this.liveShipment(input.orderId, input.sellerId);

    if (!EDITABLE_STATUSES.has(s.status)) {
      throw new ConflictException({
        code: 'COURIER_WILL_NOT_ACCEPT_CHANGES',
        message: (await this.editability(input.orderId, input.sellerId)).reason,
      });
    }
    if (s.awbNumber === null) {
      throw new ConflictException({
        code: 'NO_AWB',
        message: 'This parcel has no waybill yet, so there is nothing for the courier to change.',
      });
    }

    // Only what actually differs. Sending a field back unchanged asks
    // the courier to re-write it for no reason, and would record an
    // audit row saying something changed when nothing did.
    const name = pick(input.name, s.destRecipientName);
    const phone = pick(input.phone, s.destRecipientPhoneE164);
    const address = pick(input.addressLine1, s.destAddressLine1);
    if (name === null && phone === null && address === null) {
      throw new BadRequestException({
        code: 'NOTHING_TO_CHANGE',
        message: 'Nothing here is different from what the courier already has.',
      });
    }

    // ── THE RECORD FIRST ──────────────────────────────────────────
    // Before the courier is told, so a crash between leaves a row
    // saying what was ASKED with no acceptance stamped — which is
    // recoverable and legible. The inverse loses the request entirely
    // while the courier acts on it.
    const change = await this.prisma.client.shipmentAddressChange.create({
      data: {
        shipmentId: s.id,
        actorType: input.actor.type,
        sellerId: input.actor.sellerId ?? null,
        requestedByStaff: input.actor.staffId ?? null,
        ...(name === null ? {} : { nameBefore: s.destRecipientName, nameAfter: name }),
        ...(phone === null ? {} : { phoneBefore: s.destRecipientPhoneE164, phoneAfter: phone }),
        ...(address === null ? {} : { addressBefore: s.destAddressLine1, addressAfter: address }),
      },
      select: { id: true },
    });

    const outcome = await this.ops.edit(
      {
        courierCode: s.courierCode,
        courierAccountId: s.courierAccountId,
        courierShipmentId: s.courierShipmentId,
        awbNumber: s.awbNumber,
        ...(name === null ? {} : { name }),
        ...(phone === null ? {} : { phone }),
        ...(address === null ? {} : { address }),
      },
      // A seller correcting their own parcel is a SELLER action, not
      // ours — the audit row has to say which.
      input.actor.type === ActorType.SELLER
        ? courierActor.seller(input.actor.sellerId ?? '', null)
        : courierActor.operator(input.actor.staffId ?? ''),
    );

    if (!outcome.success) {
      await this.prisma.client.shipmentAddressChange.update({
        where: { id: change.id },
        data: { courierMessage: (outcome.message ?? 'The courier refused it.').slice(0, 500) },
      });
      return { accepted: false, changeId: change.id, message: outcome.message ?? null };
    }

    await this.prisma.client.$transaction([
      this.prisma.client.shipmentAddressChange.update({
        where: { id: change.id },
        data: { courierAcceptedAt: new Date(), courierMessage: outcome.message ?? null },
      }),
      // Our copy follows the courier's, because this is what the label,
      // the POD and every later tracking match are addressed from. The
      // ORDER's snapshot is untouched (ORD-6) — the change row is how
      // the two are reconciled.
      this.prisma.client.shipment.update({
        where: { id: s.id },
        data: {
          ...(name === null ? {} : { destRecipientName: name }),
          ...(phone === null ? {} : { destRecipientPhoneE164: phone }),
          ...(address === null ? {} : { destAddressLine1: address }),
        },
      }),
    ]);

    await this.audit.log({
      actorType: input.actor.type,
      staffUserId: input.actor.staffId ?? null,
      sellerId: input.actor.sellerId ?? null,
      action: 'courier.shipment.consignee_changed',
      entityType: 'shipment',
      entityId: s.id,
      // HIGH: this decides who a parcel is handed to.
      severity: 'HIGH',
      metadata: { changeId: change.id, awbNumber: s.awbNumber, orderId: input.orderId },
    });

    return { accepted: true, changeId: change.id, message: outcome.message ?? null };
  }

  /** The audit trail for one order, oldest first. */
  async history(orderId: string, sellerId: string | null): Promise<readonly AddressChangeRow[]> {
    const s = await this.liveShipment(orderId, sellerId);
    const rows = await this.prisma.client.shipmentAddressChange.findMany({
      where: { shipmentId: s.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        actorType: true,
        nameBefore: true,
        nameAfter: true,
        phoneBefore: true,
        phoneAfter: true,
        addressBefore: true,
        addressAfter: true,
        courierAcceptedAt: true,
        courierMessage: true,
        verifiedAt: true,
        verifiedMatch: true,
        verificationNote: true,
        createdAt: true,
      },
    });
    return rows;
  }

  private async liveShipment(orderId: string, sellerId: string | null) {
    const link = await this.prisma.client.orderShipment.findFirst({
      where: {
        orderId,
        shipment: { deletedAt: null, supersededAt: null },
        ...(sellerId === null ? {} : { order: { sellerId } }),
      },
      orderBy: { shipmentSequence: 'desc' },
      select: {
        shipment: {
          select: {
            id: true,
            status: true,
            awbNumber: true,
            courierCode: true,
            courierAccountId: true,
            courierShipmentId: true,
            destRecipientName: true,
            destRecipientPhoneE164: true,
            destAddressLine1: true,
            destCity: true,
            destStateProvince: true,
            destPostalCode: true,
          },
        },
      },
    });
    if (link?.shipment == null) {
      throw new BadRequestException({
        code: 'NO_LIVE_PARCEL',
        message: 'This order has no live parcel.',
      });
    }
    return link.shipment;
  }
}

/** The new value when it differs, else null — "not part of this change". */
function pick(next: string | undefined, current: string): string | null {
  if (next === undefined) return null;
  const t = next.trim();
  if (t === '' || t === current) return null;
  return t;
}
