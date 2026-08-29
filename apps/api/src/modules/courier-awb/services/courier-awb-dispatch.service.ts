import { Injectable, Logger } from '@nestjs/common';
import { DelhiveryAwbService } from '../../courier-delhivery/services/delhivery-awb.service';
import { DelhiveryLabelService } from '../../courier-delhivery/services/delhivery-label.service';
import type { DelhiveryAwbRequest } from '../../courier-delhivery/types/delhivery.types';
import { ShiprocketClientService } from '../../courier-shiprocket/services/shiprocket-client.service';
import { ShiprocketHttpService } from '../../courier-shiprocket/services/shiprocket-http.service';
import { DelhiveryHttpService } from '../../courier-delhivery/services/delhivery-http.service';
import type { ShiprocketAwbRequest } from '../../courier-shiprocket/types/shiprocket.types';
import type { CourierCredentialActor } from '../../courier-shared/services/courier-credential.service';

export interface DispatchAwbInput {
  readonly courierCode: string;
  readonly courierAccountId: string;
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly orderNumber: string;
  readonly pickupLocationName: string;
  readonly recipientName: string;
  readonly recipientPhoneE164: string;
  readonly addressLine1: string;
  readonly addressLine2: string;
  readonly city: string;
  readonly stateProvince: string;
  readonly postalCode: string;
  readonly countryCode: string;
  readonly totalWeightGrams: number;
  readonly declaredValueInr: string;
  readonly codAmountInr: string | null;
  readonly itemDescription: string;
  readonly items: ReadonlyArray<{
    readonly name: string;
    readonly sku: string;
    readonly quantity: number;
    readonly unitPriceInr: number;
  }>;
  readonly lengthCm: number;
  readonly breadthCm: number;
  readonly heightCm: number;
}

export interface DispatchLabelInput {
  readonly courierCode: string;
  readonly courierAccountId: string;
  readonly awbNumber: string;
  /** Shiprocket's label endpoint takes THEIR parcel id, not the AWB. */
  readonly courierShipmentId: string | null;
}

export interface DispatchLabelResult {
  readonly bytes: Buffer;
  readonly mimeType: string;
}

export interface DispatchAwbResult {
  readonly ok: boolean;
  readonly awbNumber: string | null;
  /** Their id for the parcel, where they have one. Shiprocket's label,
   *  pickup and cancel endpoints key on it rather than on the AWB. */
  readonly courierShipmentId: string | null;
  /** TRUE means "try again later"; FALSE means "this courier will not
   *  carry it", which is what makes failover and supersede correct. */
  readonly serviceable: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

/**
 * One AWB request, whichever courier answers it.
 *
 * The AWB saga should not contain a branch per courier — that is how the
 * saga's own logic (CUR-2's failure isolation, CUR-9's once-only gate)
 * ends up subtly different for each one. This is the only place that
 * knows Delhivery takes one call and Shiprocket takes two, or that one
 * returns a waybill string and the other a numeric shipment id.
 *
 * ── THE SHAPE THE CALLER NEEDS ───────────────────────────────────────
 * `serviceable` is the load-bearing field, and it means the same thing
 * for both: false is "this courier will not carry this parcel", which
 * justifies trying another one and eventually superseding; true is "ask
 * again later", which must NOT derail the order (CUR-2b — an unpicked
 * order pushed into manual placement is then refused by CUR-8 for
 * lacking phase-2 reservations).
 */
@Injectable()
export class CourierAwbDispatchService {
  private readonly logger = new Logger(CourierAwbDispatchService.name);

  constructor(
    private readonly delhivery: DelhiveryAwbService,
    private readonly delhiveryLabel: DelhiveryLabelService,
    private readonly shiprocket: ShiprocketClientService,
    private readonly delhiveryHttp: DelhiveryHttpService,
    private readonly shiprocketHttp: ShiprocketHttpService,
  ) {}

  async generate(
    input: DispatchAwbInput,
    actor: CourierCredentialActor,
  ): Promise<DispatchAwbResult> {
    switch (input.courierCode) {
      case 'shiprocket':
        return this.viaShiprocket(input);
      case 'delhivery':
        return this.viaDelhivery(input, actor);
      default:
        // A courier with no adapter is a MANUAL courier by definition
        // (CUR-8) — somebody books it by hand. Reported as
        // not-serviceable-by-us so the saga routes it to a person
        // rather than retrying an integration that does not exist.
        this.logger.warn(
          { courierCode: input.courierCode, shipmentId: input.shipmentId },
          'No adapter for this courier; routing to manual placement',
        );
        return {
          ok: false,
          awbNumber: null,
          courierShipmentId: null,
          serviceable: false,
          errorCode: 'NO_ADAPTER',
          errorMessage: `${input.courierCode} has no integration — book it by hand`,
        };
    }
  }

  /**
   * The label, whichever courier issued it — always as BYTES.
   *
   * CUR-6 says the label lives in OUR Spaces, and the two couriers make
   * that differently hard: Delhivery returns the PDF, Shiprocket returns
   * a URL to a file on their storage. Handing the caller a URL would
   * quietly satisfy the code and break the rule — their link expires,
   * and when it does the label a packer needs is gone. So the URL is
   * downloaded here and the caller only ever sees bytes.
   */
  async fetchLabel(
    input: DispatchLabelInput,
    actor: CourierCredentialActor,
  ): Promise<DispatchLabelResult> {
    if (input.courierCode === 'shiprocket') {
      if (input.courierShipmentId === null) {
        throw new Error('SHIPROCKET_LABEL_NEEDS_SHIPMENT_ID');
      }
      const { url, message } = await this.shiprocket.fetchLabel(
        input.courierShipmentId,
        input.courierAccountId,
      );
      if (url === null) {
        throw new Error(`SHIPROCKET_LABEL_UNAVAILABLE${message === null ? '' : `: ${message}`}`);
      }
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`SHIPROCKET_LABEL_FETCH_${res.status}`);
      }
      return {
        bytes: Buffer.from(await res.arrayBuffer()),
        mimeType: res.headers.get('content-type') ?? 'application/pdf',
      };
    }
    // Delhivery, and anything without an adapter: a manual courier has
    // no label to fetch, and asking Delhivery for one under a different
    // courier's AWB is how a wrong label reaches a real parcel.
    if (input.courierCode !== 'delhivery') {
      throw new Error(`NO_LABEL_ADAPTER:${input.courierCode}`);
    }
    return this.delhiveryLabel.fetchLabel(input.awbNumber, actor);
  }

  /**
   * Is this courier answering from a STUB rather than from itself?
   *
   * ── WHY THE CALLER HAS TO ASK ────────────────────────────────────
   * Stub mode returns a FABRICATED success — a made-up waybill, derived
   * from the shipment id. That is exactly right in dev and CI, and it
   * is a trap the moment one courier is live and another is not: a
   * parcel the live courier refuses would fail over to the stubbed one,
   * come back "booked" with an AWB nobody issued, and be dispatched.
   * Stock decrements, the customer is told it shipped, and no van is
   * ever coming. It surfaces as a parcel that simply never moves.
   *
   * So a stub answer may decide a TEST, never a real routing decision
   * taken alongside a live courier.
   */
  async isStubMode(courierCode: string): Promise<boolean> {
    switch (courierCode) {
      case 'shiprocket':
        return this.shiprocketHttp.isStubMode();
      case 'delhivery':
        return this.delhiveryHttp.isStubMode();
      default:
        // No adapter at all — nothing to stub, and never a failover
        // target either way.
        return true;
    }
  }

  private async viaDelhivery(
    input: DispatchAwbInput,
    actor: CourierCredentialActor,
  ): Promise<DispatchAwbResult> {
    const req: DelhiveryAwbRequest = {
      shipmentNumber: input.shipmentNumber,
      recipientName: input.recipientName,
      recipientPhoneE164: input.recipientPhoneE164,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      city: input.city,
      stateProvince: input.stateProvince,
      postalCode: input.postalCode,
      countryCode: input.countryCode,
      totalWeightGrams: input.totalWeightGrams,
      declaredValueInr: input.declaredValueInr,
      codAmountInr: input.codAmountInr,
      itemDescription: input.itemDescription,
    };
    const r = await this.delhivery.generateAwb(req, actor, input.courierAccountId);
    return {
      ok: r.ok,
      awbNumber: r.ok ? r.awbNumber : null,
      // Delhivery's waybill IS the identifier for everything after.
      courierShipmentId: null,
      serviceable: r.ok ? true : r.serviceable,
      errorCode: r.ok ? null : (r.errorCode ?? null),
      errorMessage: r.ok ? null : (r.errorMessage ?? null),
    };
  }

  private async viaShiprocket(input: DispatchAwbInput): Promise<DispatchAwbResult> {
    const req: ShiprocketAwbRequest = {
      shipmentId: input.shipmentId,
      orderNumber: input.orderNumber,
      pickupLocationName: input.pickupLocationName,
      recipient: {
        name: input.recipientName,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2,
        city: input.city,
        state: input.stateProvince,
        pincode: input.postalCode,
        phoneE164: input.recipientPhoneE164,
        email: null,
      },
      items: input.items.map((i) => ({
        name: i.name,
        sku: i.sku,
        quantity: i.quantity,
        unitPriceInr: i.unitPriceInr,
      })),
      paymentMode: input.codAmountInr !== null ? 'COD' : 'PREPAID',
      subTotalInr: Number(input.declaredValueInr),
      weightGrams: input.totalWeightGrams,
      lengthCm: input.lengthCm,
      breadthCm: input.breadthCm,
      heightCm: input.heightCm,
    };
    const r = await this.shiprocket.generateAwb(req, input.courierAccountId);
    if (r.ok) {
      return {
        ok: true,
        awbNumber: r.awbNumber,
        courierShipmentId: r.courierShipmentId,
        serviceable: true,
        errorCode: null,
        errorMessage: null,
      };
    }
    return {
      ok: false,
      awbNumber: null,
      courierShipmentId: null,
      // Their two failure kinds map onto the one field the saga reads.
      serviceable: r.failure === 'TRANSIENT',
      errorCode: r.failure,
      errorMessage: r.message,
    };
  }
}
