import { Injectable, NotFoundException } from '@nestjs/common';
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
  readonly isManualCourier: boolean;
  /**
   * The parcel's CURRENT NSL, as the courier last reported it.
   *
   * The field Delhivery's re-attempt eligibility is actually written
   * against — "the current NSL code for the shipment" — so it belongs on
   * the shipment's context rather than being reconstructed from an
   * attempt row.
   */
  readonly currentNslCode: string | null;
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

  async resolve(shipmentId: string): Promise<ShipmentCourierContext> {
    const shipment = await this.prisma.client.shipment.findFirst({
      where: { id: shipmentId, deletedAt: null },
      select: {
        id: true,
        shipmentNumber: true,
        awbNumber: true,
        courierCode: true,
        courierAccountId: true,
        courierShipmentId: true,
        isManualCourier: true,
        courierNslCode: true,
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
      isManualCourier: shipment.isManualCourier,
      currentNslCode: shipment.courierNslCode,
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
