import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ActorType, SellerStoreKind, ShipmentStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CourierOpsDispatchService } from '../../courier-ops/services/courier-ops-dispatch.service';
import { courierActor } from '../../courier-shared/services/courier-credential.service';
import { StoreRequestNotifier } from '../../store-order-request/services/store-request-notifier.service';
import { COURIER_EDITABLE_SHIPMENT_STATUSES } from '../../order/recipient-change-route';

/**
 * When the courier will still accept a correction — the ONE list, shared
 * with `OrderService.edit` through `recipientChangeRoute` (2026-09-18).
 * It used to be declared here as well, which is two lists that have to
 * agree about a fact neither owns; the surviving copy is beside the
 * routing decision that reads it.
 */
const EDITABLE_STATUSES = COURIER_EDITABLE_SHIPMENT_STATUSES;

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
  private readonly logger = new Logger(ShipmentAddressService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ops: CourierOpsDispatchService,
    private readonly audit: AuditLogService,
    // 2026-09-18 — a reseller store's order has two parties, and both are
    // told whether the courier took the change. Imports nothing
    // order-shaped, so this closes no cycle.
    private readonly notifier: StoreRequestNotifier,
  ) {}

  /** What the seller may change right now, and the current values. */
  async editability(
    orderId: string,
    sellerId: string | null,
    storeId?: string,
  ): Promise<AddressEditability> {
    const s = await this.liveShipment(orderId, sellerId, storeId);
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
    /** RS-5: set when a reseller STORE is correcting its own parcel. */
    storeId?: string;
    name?: string;
    phone?: string;
    addressLine1?: string;
    actor: {
      type: ActorType;
      staffId?: string | null;
      sellerId?: string | null;
      storeUserId?: string | null;
    };
  }): Promise<ChangeResult> {
    const s = await this.liveShipment(input.orderId, input.sellerId, input.storeId);

    if (!EDITABLE_STATUSES.has(s.status)) {
      throw new ConflictException({
        code: 'COURIER_WILL_NOT_ACCEPT_CHANGES',
        message: (await this.editability(input.orderId, input.sellerId, input.storeId)).reason,
      });
    }
    if (s.awbNumber === null) {
      throw new ConflictException({
        code: 'NO_AWB',
        message: 'This parcel has no waybill yet, so there is nothing for the courier to change.',
      });
    }

    /*
      ── A STUB MAY NOT CONFIRM A REAL ADDRESS CHANGE (CUR-15) ─────

      Both adapters' edit paths answer `{success: true, message: 'stub'}`
      BEFORE the live-write guard runs. That is exactly right in dev and
      CI. In production, with one courier live and another stubbed, it
      is the most consequential version of the failure CUR-15 exists to
      stop: a seller's or a store's correction is reported ACCEPTED, the
      new address is written to the change row, the shipment AND the
      order (all three, below) — and the courier never heard of it. The
      driver still has the old address, the call centre reads out the
      new one, and the divergence is invisible because every screen
      agrees with every other screen.

      This is the same guard `CourierShipmentActionService.cancelWithCourier`
      already applies, for the same reason, and it was the only place
      that applied it. Refused BY NAME, and BEFORE the change row is
      created: a row saying what was asked is only useful when
      something was actually asked.
    */
    if (await this.ops.isStubbedInProduction(s.courierCode)) {
      throw new ConflictException({
        code: 'COURIER_STUBBED',
        message: `${s.courierCode} is not connected to its live API here, so this correction would reach nobody and we would store an address the parcel is not going to. Change it in the courier's own portal.`,
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
      // WHO told the courier to redirect this parcel. A store's ask is a
      // STORE action, not the seller's and not ours — the CUR-1 decrypt
      // audit has to say which, because only one of the three has to
      // answer for it when the customer rings.
      input.actor.type === ActorType.STORE
        ? courierActor.store(input.storeId ?? '', input.actor.storeUserId ?? null)
        : input.actor.type === ActorType.SELLER
          ? courierActor.seller(input.actor.sellerId ?? '', null)
          : courierActor.operator(input.actor.staffId ?? ''),
    );

    if (!outcome.success) {
      /*
        REFUSED — AND THE ORDER KEEPS THE ADDRESS THE PARCEL IS GOING TO
        (owner, 2026-09-18).

        Nothing is written to the shipment or the order. That is the whole
        rule: a stored address the courier never took is a promise nobody
        can keep, and it would be read out by the call centre, printed on
        a return label and believed by both parties. The change row keeps
        the courier's OWN WORDS so the refusal can be repeated to a
        customer verbatim rather than paraphrased into something softer.
      */
      await this.prisma.client.shipmentAddressChange.update({
        where: { id: change.id },
        data: { courierMessage: (outcome.message ?? 'The courier refused it.').slice(0, 500) },
      });
      await this.tellBothSides(
        input.orderId,
        { name, phone, address },
        false,
        outcome.message ?? null,
      );
      return { accepted: false, changeId: change.id, message: outcome.message ?? null };
    }

    await this.prisma.client.$transaction([
      this.prisma.client.shipmentAddressChange.update({
        where: { id: change.id },
        data: { courierAcceptedAt: new Date(), courierMessage: outcome.message ?? null },
      }),
      // Our copy follows the courier's, because this is what the label,
      // the POD and every later tracking match are addressed from.
      this.prisma.client.shipment.update({
        where: { id: s.id },
        data: {
          ...(name === null ? {} : { destRecipientName: name }),
          ...(phone === null ? {} : { destRecipientPhoneE164: phone }),
          ...(address === null ? {} : { destAddressLine1: address }),
        },
      }),
      /*
        AND THE ORDER FOLLOWS IT TOO (owner, 2026-09-18).

        This used to leave the order alone and call the change row "how
        the two are reconciled", citing ORD-6. That was a reading of ORD-6
        the owner has now overruled, and it was a real divergence: the
        order's recipient block is what the call centre reads out, what
        the seller and the store see on screen, and what any later parcel
        for this order is provisioned from — so an accepted change left
        every one of those showing an address the courier no longer had.
        Only ever written on ACCEPTANCE, which is what makes "never store
        an address the parcel is not going to" true in both directions.
      */
      this.prisma.client.order.update({
        where: { id: input.orderId },
        data: {
          ...(name === null ? {} : { recipientName: name }),
          ...(phone === null ? {} : { recipientPhoneE164: phone }),
          ...(address === null ? {} : { recipientAddressLine1: address }),
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

    await this.tellBothSides(
      input.orderId,
      { name, phone, address },
      true,
      outcome.message ?? null,
    );
    return { accepted: true, changeId: change.id, message: outcome.message ?? null };
  }

  /**
   * On a reseller store's order, tell the party who did not ask — and on
   * a REFUSAL tell BOTH, because the answer "the courier would not take
   * it" is what somebody has to repeat to the customer (owner, 2026-09-18).
   *
   * Never throws: the courier's answer and the change row are the durable
   * facts. Awaited rather than fired and forgotten, so the e2e reset has
   * no in-flight write to drain (NOTIF-19).
   */
  private async tellBothSides(
    orderId: string,
    fields: { name: string | null; phone: string | null; address: string | null },
    accepted: boolean,
    courierSaid: string | null,
  ): Promise<void> {
    try {
      const order = await this.prisma.client.order.findFirst({
        where: { id: orderId, storeKind: SellerStoreKind.RESELLER },
        select: {
          id: true,
          orderNumber: true,
          sellerId: true,
          storeId: true,
          storeNameSnapshot: true,
        },
      });
      if (order === null) return;
      const seller = await this.prisma.client.seller.findUnique({
        where: { id: order.sellerId },
        select: { companyName: true },
      });
      const changed = [
        fields.name === null ? null : `Name → ${fields.name}`,
        fields.phone === null ? null : `Phone → ${fields.phone}`,
        fields.address === null ? null : `Address → ${fields.address}`,
      ]
        .filter((l): l is string => l !== null)
        .join('\n');
      const money = accepted
        ? 'The courier accepted the change, so this is where the parcel is now going.'
        : 'THE COURIER REFUSED IT, so the parcel is still going to the address it had. ' +
          (courierSaid === null ? '' : `They said: “${courierSaid}”.`);
      const eventKey = `${orderId}:consignee:${accepted ? 'yes' : 'no'}:${Date.now()}`;
      await this.notifier.orderChangedBySeller({
        storeId: order.storeId,
        eventKey,
        orderId: order.id,
        orderNumber: order.orderNumber,
        sellerName: seller?.companyName ?? 'Your seller',
        changes: changed,
        money,
        supersededRequest: false,
      });
      await this.notifier.orderChangedByStore({
        sellerId: order.sellerId,
        eventKey,
        orderId: order.id,
        orderNumber: order.orderNumber,
        storeName: order.storeNameSnapshot ?? 'a reseller store',
        changes: changed,
        money,
      });
    } catch (err) {
      this.logger.warn(
        { orderId, err: err instanceof Error ? err.message : err },
        'Could not tell both sides what the courier said about a consignee change',
      );
    }
  }

  /** The audit trail for one order, oldest first. */
  async history(
    orderId: string,
    sellerId: string | null,
    storeId?: string,
  ): Promise<readonly AddressChangeRow[]> {
    const s = await this.liveShipment(orderId, sellerId, storeId);
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

  private async liveShipment(orderId: string, sellerId: string | null, storeId?: string) {
    const link = await this.prisma.client.orderShipment.findFirst({
      where: {
        orderId,
        shipment: { deletedAt: null, supersededAt: null },
        // Scoped in the WHERE clause, never fetched then compared: a
        // store reaching for another store's parcel finds nothing.
        ...(sellerId === null && storeId === undefined
          ? {}
          : {
              order: {
                ...(sellerId === null ? {} : { sellerId }),
                ...(storeId === undefined ? {} : { storeId, storeKind: SellerStoreKind.RESELLER }),
              },
            }),
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
