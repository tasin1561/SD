import { Injectable, NotFoundException } from '@nestjs/common';
import { ShipmentStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

const ORIGIN_PIN_SETTING = 'courier.delhivery_origin_pincode';

export interface ShipmentCourierContext {
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly awbNumber: string | null;
  readonly courierCode: string;
  /** Which of that courier's accounts carries it — Shiprocket's calls
   *  are per-account, so a null here means we cannot address them. */
  readonly courierAccountId: string | null;
  /** Shiprocket's own parcel id — their label, pickup, cancel and POD
   *  endpoints key on it rather than on the AWB. Null for Delhivery. */
  readonly courierShipmentId: string | null;
  /**
   * The courier's own ORDER id, where they keep it apart from the parcel
   * id. Shiprocket's `orders/address/update` keys on THIS — passing the
   * parcel id gets `422 "The selected order id is invalid"`, which is
   * how that edit had never once worked.
   */
  readonly courierOrderId: string | null;
  readonly isManualCourier: boolean;
  /**
   * The destination as the shipment snapshotted it (ORD-6).
   *
   * Carried because Shiprocket's address update is NOT a patch: it
   * validates the COMPLETE shipping block and refuses a partial one
   * (`422 "The shipping country field is required"`). So an edit of one
   * line has to be merged over the current values, and these are them.
   */
  readonly destination: {
    readonly name: string;
    readonly addressLine1: string;
    readonly addressLine2: string | null;
    readonly city: string;
    readonly stateProvince: string;
    readonly postalCode: string;
    readonly phoneE164: string;
    readonly email: string | null;
  };
  /**
   * The parcel's CURRENT NSL, as the courier last reported it.
   *
   * The field Delhivery's re-attempt eligibility is actually written
   * against — "the current NSL code for the shipment" — so it belongs on
   * the shipment's context rather than being reconstructed from an
   * attempt row.
   */
  readonly currentNslCode: string | null;
  /** When the courier accepted a cancellation of this waybill; null if
   *  nobody has cancelled it with them. */
  readonly courierCancelledAt: Date | null;
  readonly status: string;
  readonly originPin: string | null;
  readonly destinationPin: string;
  readonly chargeableWeightGrams: number;
  readonly declaredValueInr: string;
  readonly codAmountInr: string | null;
  readonly isCod: boolean;
  readonly lengthCm: number | null;
  readonly widthCm: number | null;
  readonly heightCm: number | null;
  readonly orderId: string | null;
}

/**
 * Turns a shipment id into the raw inputs the Delhivery adapter takes.
 *
 * The adapter services are deliberately dumb about our domain — they ask
 * for pincodes, grams and payment types, not shipment ids. That keeps
 * them testable against the wire contract and nothing else. The cost of
 * that choice is that SOMETHING has to do the resolution, and doing it
 * inline in five different controllers is how the five slowly disagree
 * about which weight field to use.
 *
 * So: one resolver, one set of answers.
 *
 * **Chargeable weight** falls back through `chargeableWeightGrams` →
 * `declaredWeightGrams` → `totalWeightGrams`. Delhivery prices on the
 * greater of dead and volumetric weight and computes that itself; what
 * we send is our best statement of the parcel, and the most specific
 * figure we hold is the truest one.
 *
 * **Origin pin** comes from a system setting rather than the warehouse
 * row, because warehouses carry no address in Phase 1A — the same reason
 * the pickup location is a setting. It returns null rather than throwing
 * when unset, so a caller can render "configure the origin pincode"
 * instead of a 500.
 */
@Injectable()
export class ShipmentCourierContextService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `includeVoided` also finds a shipment `voidForOrder` retired when its
   * order was cancelled (status CANCELLED + `deletedAt` set). Only the
   * waybill cancel asks for it: a voided shipment's waybill can still be
   * live with the courier, and cancelling it is the one courier action
   * that makes sense on it. Every other caller keeps seeing it as gone.
   */
  async resolve(
    shipmentId: string,
    opts: { readonly includeVoided?: boolean } = {},
  ): Promise<ShipmentCourierContext> {
    const shipment = await this.prisma.client.shipment.findFirst({
      where:
        opts.includeVoided === true
          ? {
              id: shipmentId,
              OR: [{ deletedAt: null }, { status: ShipmentStatus.CANCELLED }],
            }
          : { id: shipmentId, deletedAt: null },
      select: {
        id: true,
        shipmentNumber: true,
        awbNumber: true,
        courierCode: true,
        courierAccountId: true,
        courierShipmentId: true,
        courierOrderId: true,
        isManualCourier: true,
        destRecipientName: true,
        destRecipientPhoneE164: true,
        destAddressLine1: true,
        destAddressLine2: true,
        destCity: true,
        destStateProvince: true,
        courierNslCode: true,
        courierCancelledAt: true,
        status: true,
        destPostalCode: true,
        totalWeightGrams: true,
        declaredWeightGrams: true,
        chargeableWeightGrams: true,
        declaredValueInr: true,
        codAmountInr: true,
        lengthCm: true,
        widthCm: true,
        heightCm: true,
        orderShipments: { select: { orderId: true }, take: 1 },
      },
    });
    if (shipment === null) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: `No shipment ${shipmentId}.`,
      });
    }

    const originPin = await this.originPin();
    const cod = shipment.codAmountInr;

    return {
      shipmentId: shipment.id,
      shipmentNumber: shipment.shipmentNumber,
      awbNumber: shipment.awbNumber,
      courierCode: shipment.courierCode,
      courierAccountId: shipment.courierAccountId,
      courierShipmentId: shipment.courierShipmentId,
      courierOrderId: shipment.courierOrderId,
      isManualCourier: shipment.isManualCourier,
      destination: {
        name: shipment.destRecipientName,
        addressLine1: shipment.destAddressLine1,
        addressLine2: shipment.destAddressLine2,
        city: shipment.destCity,
        stateProvince: shipment.destStateProvince,
        postalCode: shipment.destPostalCode,
        phoneE164: shipment.destRecipientPhoneE164,
        email: null,
      },
      currentNslCode: shipment.courierNslCode,
      courierCancelledAt: shipment.courierCancelledAt,
      status: shipment.status,
      originPin,
      destinationPin: shipment.destPostalCode,
      chargeableWeightGrams:
        shipment.chargeableWeightGrams ?? shipment.declaredWeightGrams ?? shipment.totalWeightGrams,
      declaredValueInr: shipment.declaredValueInr.toString(),
      codAmountInr: cod === null ? null : cod.toString(),
      isCod: cod !== null && cod.greaterThan(0),
      lengthCm: shipment.lengthCm === null ? null : Number(shipment.lengthCm),
      widthCm: shipment.widthCm === null ? null : Number(shipment.widthCm),
      heightCm: shipment.heightCm === null ? null : Number(shipment.heightCm),
      orderId: shipment.orderShipments[0]?.orderId ?? null,
    };
  }

  /** Null when unconfigured — the caller says so rather than 500ing. */
  async originPin(): Promise<string | null> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: ORIGIN_PIN_SETTING },
      select: { valueString: true },
    });
    const value = (row?.valueString ?? '').trim();
    return value === '' ? null : value;
  }
}
