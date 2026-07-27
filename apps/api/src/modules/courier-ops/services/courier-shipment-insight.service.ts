import { Injectable, BadRequestException } from '@nestjs/common';
import {
  DelhiveryTatService,
  type DelhiveryTransportMode,
} from '../../courier-delhivery/services/delhivery-tat.service';
import { DelhiveryCostService } from '../../courier-delhivery/services/delhivery-cost.service';
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
  /** What Delhivery actually bills us for this parcel. */
  readonly cost: {
    readonly totalInr: string;
    readonly deliveryInr: string;
    readonly codFeeInr: string;
    readonly taxInr: string;
    readonly zone: string | null;
    readonly chargedWeightGrams: number;
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
  ) {}

  async insight(
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
        'This parcel was placed manually with a non-integrated courier, so Delhivery has nothing to say about its time or cost.',
      );
      return { shipment, tat: null, cost: null, unavailable };
    }

    const originPin = shipment.originPin;

    // Independent, and slow enough over the wire that serialising them
    // would be felt on a page load.
    const [tat, cost] = await Promise.all([
      this.tat
        .expectedTat({
          originPin,
          destinationPin: shipment.destinationPin,
          ...(opts.mode === undefined ? {} : { mode: opts.mode }),
        })
        .catch((err: unknown) => {
          unavailable.push(`Expected delivery time: ${describe(err)}`);
          return null;
        }),
      this.cost
        .estimate({
          originPin,
          destinationPin: shipment.destinationPin,
          chargeableWeightGrams: shipment.chargeableWeightGrams,
          paymentType: shipment.isCod ? 'COD' : 'Pre-paid',
          ...(shipment.lengthCm === null ? {} : { lengthCm: shipment.lengthCm }),
          ...(shipment.widthCm === null ? {} : { breadthCm: shipment.widthCm }),
          ...(shipment.heightCm === null ? {} : { heightCm: shipment.heightCm }),
        })
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
        message:
          'This shipment has no AWB yet, so the courier holds no paperwork for it.',
      });
    }
    const result = await this.documents.fetch(shipment.awbNumber, docType);
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
