import { ShiprocketClientService } from '../../courier-shiprocket/services/shiprocket-client.service';
import { Injectable, BadRequestException } from '@nestjs/common';
import {
  DelhiveryTatService,
  type DelhiveryTransportMode,
} from '../../courier-delhivery/services/delhivery-tat.service';
import { DelhiveryCostService } from '../../courier-delhivery/services/delhivery-cost.service';
import { courierActor } from '../../courier-shared/services/courier-credential.service';
import {
  DelhiveryDocumentService,
  type DelhiveryDocumentType,
} from '../../courier-delhivery/services/delhivery-document.service';
import {
  ShipmentCourierContextService,
  type ShipmentCourierContext,
} from './shipment-courier-context.service';

export interface ShipmentInsight {
  readonly shipment: ShipmentCourierContext;
  /** Null when the origin pincode is unconfigured or the lane is unquotable. */
  readonly tat: {
    readonly tatDays: number | null;
    readonly mode: DelhiveryTransportMode;
    readonly fromLiveApi: boolean;
    readonly message: string | null;
  } | null;
  /**
   * What the courier actually bills us for this parcel.
   *
   * The breakdown fields are NULLABLE because Shiprocket quotes one
   * number and Delhivery itemises. Reporting an absent leg as zero
   * would read as measured and be invented, and the panel would say
   * "COD fee ₹0.00" on a COD parcel that certainly has one.
   */
  readonly cost: {
    readonly totalInr: string;
    readonly deliveryInr: string | null;
    readonly codFeeInr: string | null;
    readonly taxInr: string | null;
    readonly zone: string | null;
    readonly chargedWeightGrams: number | null;
    readonly volumetricDivisor: number | null;
    readonly fromLiveApi: boolean;
    readonly components: Readonly<Record<string, string>>;
  } | null;
  /** Why a section is missing, when it is. */
  readonly unavailable: readonly string[];
}

/**
 * The courier's own view of one shipment: how long it should take, what
 * it costs us, and the paperwork behind it.
 *
 * All three are READ-ONLY and free, so none is gated by the write guard
 * — the guard exists for calls with a physical or billable effect, and
 * applying it here would hide useful information for no safety gain.
 *
 * ── WHY THE PARTS DEGRADE INDEPENDENTLY ──────────────────────────────
 * A missing origin pincode makes TAT and cost unanswerable but says
 * nothing about the document endpoint. A lane Delhivery declines to
 * quote does not invalidate the TAT. So each part is attempted on its
 * own and a failure lands in `unavailable` with a readable reason rather
 * than failing the whole request — an operator looking at a disputed
 * delivery still gets the EPOD even if the cost lookup is down.
 */
@Injectable()
export class CourierShipmentInsightService {
  constructor(
    private readonly context: ShipmentCourierContextService,
    private readonly tat: DelhiveryTatService,
    private readonly cost: DelhiveryCostService,
    private readonly documents: DelhiveryDocumentService,
    private readonly shiprocket: ShiprocketClientService,
  ) {}

  async insight(
    staffId: string,
    shipmentId: string,
    opts: { mode?: DelhiveryTransportMode } = {},
  ): Promise<ShipmentInsight> {
    const shipment = await this.context.resolve(shipmentId);
    const unavailable: string[] = [];

    if (shipment.originPin === null) {
      unavailable.push(
        'Origin pincode is not configured (system setting courier.delhivery_origin_pincode), so this lane cannot be priced or timed.',
      );
      return { shipment, tat: null, cost: null, unavailable };
    }
    if (shipment.isManualCourier) {
      unavailable.push(
        'This parcel was placed manually with a non-integrated courier, so there is nobody to ask about its time or cost.',
      );
      return { shipment, tat: null, cost: null, unavailable };
    }

    const originPin = shipment.originPin;

    // ── SHIPROCKET ANSWERS BOTH IN ONE CALL ───────────────────────────
    // Their serviceability response carries the rate AND the ETD per
    // carrier, so the two questions Delhivery splits across two
    // endpoints are one request here. The FIELDS stay separate because
    // that split is Delhivery's shape rather than a property of the
    // question, and collapsing them would make the panel mean different
    // things depending on who carries the parcel.
    if (shipment.courierCode === 'shiprocket') {
      if (shipment.courierAccountId === null) {
        unavailable.push(
          'No Shiprocket account is recorded on this parcel, so it cannot be priced or timed.',
        );
        return { shipment, tat: null, cost: null, unavailable };
      }
      try {
        const lane = await this.shiprocket.estimateLane(
          {
            pickupPincode: originPin,
            deliveryPincode: shipment.destinationPin,
            weightGrams: shipment.chargeableWeightGrams,
            isCod: shipment.isCod,
          },
          shipment.courierAccountId,
        );
        return {
          shipment,
          tat:
            lane.etdDays === null
              ? null
              : {
                  tatDays: lane.etdDays,
                  // Their aggregation hides the transport mode; naming
                  // the carrier they would actually use is the honest
                  // equivalent and is more useful besides.
                  mode: (lane.carrierName ?? 'Shiprocket') as DelhiveryTransportMode,
                  fromLiveApi: lane.fromLiveApi,
                  message: null,
                },
          cost:
            lane.totalInr === null
              ? null
              : {
                  // Money is carried as a string everywhere else, and
                  // a number here would round differently on the way to
                  // the page than every other figure on it.
                  totalInr: lane.totalInr.toFixed(2),
                  // They quote ONE number. Reporting a breakdown we do
                  // not have — a zero delivery leg, a zero COD fee —
                  // would read as measured and be invented.
                  deliveryInr: null,
                  codFeeInr: null,
                  taxInr: null,
                  zone: null,
                  chargedWeightGrams: null,
                  volumetricDivisor: null,
                  fromLiveApi: lane.fromLiveApi,
                  // Empty rather than fabricated: they quote a total,
                  // and naming the carrier is the only component we
                  // genuinely learned.
                  components: lane.carrierName === null ? {} : { carrier: lane.carrierName },
                },
          unavailable,
        };
      } catch (err) {
        unavailable.push(`Expected delivery time and courier cost: ${describe(err)}`);
        return { shipment, tat: null, cost: null, unavailable };
      }
    }

    // Independent, and slow enough over the wire that serialising them
    // would be felt on a page load.
    const [tat, cost] = await Promise.all([
      this.tat
        .expectedTat(
          {
            originPin,
            destinationPin: shipment.destinationPin,
            ...(opts.mode === undefined ? {} : { mode: opts.mode }),
          },
          courierActor.operator(staffId),
        )
        .catch((err: unknown) => {
          unavailable.push(`Expected delivery time: ${describe(err)}`);
          return null;
        }),
      this.cost
        .estimate(
          {
            originPin,
            destinationPin: shipment.destinationPin,
            chargeableWeightGrams: shipment.chargeableWeightGrams,
            paymentType: shipment.isCod ? 'COD' : 'Pre-paid',
            ...(shipment.lengthCm === null ? {} : { lengthCm: shipment.lengthCm }),
            ...(shipment.widthCm === null ? {} : { breadthCm: shipment.widthCm }),
            ...(shipment.heightCm === null ? {} : { heightCm: shipment.heightCm }),
          },
          courierActor.operator(staffId),
        )
        .catch((err: unknown) => {
          unavailable.push(`Courier cost: ${describe(err)}`);
          return null;
        }),
    ]);

    return {
      shipment,
      tat:
        tat === null
          ? null
          : {
              tatDays: tat.tatDays,
              mode: tat.mode,
              fromLiveApi: tat.fromLiveApi,
              message: tat.message,
            },
      cost:
        cost === null
          ? null
          : {
              totalInr: cost.totalInr,
              deliveryInr: cost.deliveryInr,
              codFeeInr: cost.codFeeInr,
              taxInr: cost.taxInr,
              zone: cost.zone,
              chargedWeightGrams: cost.chargedWeightGrams,
              volumetricDivisor: cost.volumetricDivisor,
              fromLiveApi: cost.fromLiveApi,
              components: cost.components,
            },
      unavailable,
    };
  }

  /**
   * Proof of delivery, signature, or a QC image.
   *
   * Delhivery only serves documents that are "not archived", so an EPOD
   * chased months after the fact may simply be gone — worth pulling
   * while a dispute is live rather than assuming it will keep.
   */
  async document(
    staffId: string,
    shipmentId: string,
    docType: DelhiveryDocumentType,
  ): Promise<{
    readonly shipmentId: string;
    readonly awbNumber: string;
    readonly docType: DelhiveryDocumentType;
    readonly url: string | null;
    readonly message: string | null;
  }> {
    const shipment = await this.context.resolve(shipmentId);
    if (shipment.awbNumber === null) {
      throw new BadRequestException({
        code: 'SHIPMENT_HAS_NO_AWB',
        message: 'This shipment has no AWB yet, so the courier holds no paperwork for it.',
      });
    }
    if (shipment.courierCode === 'shiprocket') {
      // They expose ONE document where Delhivery has four. Returning
      // the POD for a signature or an RVP QC request would hand back
      // the wrong evidence labelled as the right one, which is worse in
      // a dispute than saying we do not have it.
      if (docType !== 'EPOD') {
        return {
          shipmentId: shipment.shipmentId,
          awbNumber: shipment.awbNumber,
          docType,
          url: null,
          message: `Shiprocket holds proof of delivery only — no ${docType.toLowerCase()} exists for this parcel.`,
        };
      }
      if (shipment.courierAccountId === null || shipment.courierShipmentId === null) {
        return {
          shipmentId: shipment.shipmentId,
          awbNumber: shipment.awbNumber,
          docType,
          url: null,
          // Their document endpoint keys on THEIR parcel id, not the
          // AWB, so without it there is nothing to ask about.
          message:
            'This parcel carries no Shiprocket account or parcel id, so their POD cannot be fetched.',
        };
      }
      const pod = await this.shiprocket.fetchPod(
        shipment.courierShipmentId,
        shipment.courierAccountId,
      );
      return {
        shipmentId: shipment.shipmentId,
        awbNumber: shipment.awbNumber,
        docType,
        url: pod.url,
        message: pod.message,
      };
    }

    const result = await this.documents.fetch(
      shipment.awbNumber,
      docType,
      courierActor.operator(staffId),
    );
    return {
      shipmentId: shipment.shipmentId,
      awbNumber: shipment.awbNumber,
      docType,
      url: result.url,
      message: result.message,
    };
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : 'lookup failed';
}
