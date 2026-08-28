import { Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import type { CourierCredentialActor } from '../../courier-shared/services/courier-credential.service';
import type {
  CourierTrackingResult,
  NormalizedScan,
} from '../../courier-delhivery/types/delhivery.types';
import {
  SHIPROCKET_STATUS_MAP,
  type ShiprocketAssignAwbResponse,
  type ShiprocketAwbRequest,
  type ShiprocketAwbFailure,
  type ShiprocketAwbResult,
  type ShiprocketCreateOrderRequest,
  type ShiprocketCreateOrderResponse,
  type ShiprocketLabelResponse,
  type ShiprocketServiceabilityResponse,
  type ShiprocketTrackingResponse,
} from '../types/shiprocket.types';
import { toIsoWithIst } from '../../tracking-events/services/courier-time';
import { ShiprocketHttpService } from './shiprocket-http.service';

/** Their refusals that mean "not this address", as opposed to "not now". */
const NON_SERVICEABLE_HINTS = [
  'not serviceable',
  'no courier',
  'pincode',
  'not available',
  'unserviceable',
];

/**
 * Shiprocket, behind the same capability surface as Delhivery.
 *
 * The AWB saga, the label persistence and the tracking poller should not
 * know which courier they are talking to — so the differences are
 * absorbed here: the two-step creation, the expiring token, the numeric
 * shipment id, the weight in kilograms.
 *
 * ── STUB MODE ────────────────────────────────────────────────────────
 * No account is provisioned, so this is the only mode that currently
 * runs. It is deterministic and keyed on the destination pincode, the
 * same convention the Delhivery stub uses so the two behave alike under
 * test: `999999` fails transiently, `000000` is non-serviceable.
 */
@Injectable()
export class ShiprocketClientService {
  private readonly logger = new Logger(ShiprocketClientService.name);

  constructor(private readonly http: ShiprocketHttpService) {}

  private actor(): CourierCredentialActor {
    return { type: ActorType.SYSTEM };
  }

  /**
   * Create the order, then assign the AWB.
   *
   * TWO calls where Delhivery takes one, and the seam between them is
   * the part worth care: if the order is created and the assign then
   * fails, Shiprocket holds an order with no AWB. We return the failure
   * and the AWB saga routes to manual placement (CUR-2) — we do NOT
   * retry the create, because a retry would make a second order for the
   * same parcel and their `order_id` uniqueness is per-channel, not
   * enforced for adhoc orders. Their order is left for an operator to
   * see in their dashboard; a duplicate would be worse than an orphan.
   */
  async generateAwb(
    req: ShiprocketAwbRequest,
    courierAccountId: string,
  ): Promise<ShiprocketAwbResult> {
    if (await this.http.isStubMode()) return this.stubAwb(req);

    const created = await this.createOrder(req, courierAccountId);
    if (!created.ok) return created;

    try {
      const assigned = await this.http.request<ShiprocketAssignAwbResponse>({
        method: 'POST',
        path: '/v1/external/courier/assign/awb',
        body: { shipment_id: created.shipmentId },
        actor: this.actor(),
        courierAccountId,
      });

      const awb = assigned.response?.data?.awb_code;
      if (assigned.awb_assign_status !== 1 || typeof awb !== 'string' || awb === '') {
        const message = assigned.message ?? 'Shiprocket assigned no AWB and gave no reason';
        return {
          ok: false,
          failure: this.classify(message),
          message,
        };
      }

      return {
        ok: true,
        awbNumber: awb,
        courierShipmentId: String(created.shipmentId),
        courierOrderId: String(created.orderId),
        courierName: assigned.response?.data?.courier_name ?? null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { orderNumber: req.orderNumber, shipmentId: created.shipmentId, message },
        'Shiprocket created the order but would not assign an AWB',
      );
      return { ok: false, failure: this.classify(message), message };
    }
  }

  private async createOrder(
    req: ShiprocketAwbRequest,
    courierAccountId: string,
  ): Promise<
    // Its OWN result type, not the AWB one. Sharing it made both
    // branches structurally `ok: true` and the narrowing collapsed —
    // TypeScript could no longer tell an order from a finished AWB.
    | { readonly ok: true; readonly orderId: number; readonly shipmentId: number }
    | { readonly ok: false; readonly failure: ShiprocketAwbFailure; readonly message: string }
  > {
    // Their `billing_*` block is the RECIPIENT, not whoever paid, and
    // `shipping_is_billing` says "ship there too" — which is our only
    // case, since an order carries one address.
    const [firstName, ...rest] = req.recipient.name.trim().split(/\s+/);
    const body: ShiprocketCreateOrderRequest = {
      order_id: req.orderNumber,
      order_date: new Date().toISOString().slice(0, 19).replace('T', ' '),
      pickup_location: req.pickupLocationName,
      billing_customer_name: firstName ?? req.recipient.name,
      // Their API wants the surname separately and rejects an empty one
      // on some plans; a single-word name repeats rather than sends ''.
      billing_last_name: rest.length > 0 ? rest.join(' ') : (firstName ?? ''),
      billing_address: req.recipient.addressLine1,
      billing_address_2: req.recipient.addressLine2,
      billing_city: req.recipient.city,
      billing_pincode: req.recipient.pincode,
      billing_state: req.recipient.state,
      billing_country: 'India',
      billing_email: req.recipient.email ?? '',
      // They want a bare 10-digit number, not E.164.
      billing_phone: req.recipient.phoneE164.replace(/^\+91/, '').replace(/\D/g, ''),
      shipping_is_billing: true,
      order_items: req.items.map((i) => ({
        name: i.name,
        sku: i.sku,
        units: i.quantity,
        selling_price: i.unitPriceInr,
      })),
      payment_method: req.paymentMode === 'COD' ? 'COD' : 'Prepaid',
      sub_total: req.subTotalInr,
      length: req.lengthCm,
      breadth: req.breadthCm,
      height: req.heightCm,
      // KILOGRAMS. Ours are grams everywhere else.
      weight: req.weightGrams / 1000,
    };

    try {
      const res = await this.http.request<ShiprocketCreateOrderResponse>({
        method: 'POST',
        path: '/v1/external/orders/create/adhoc',
        body,
        actor: this.actor(),
        courierAccountId,
      });
      if (typeof res.shipment_id !== 'number' || res.shipment_id === 0) {
        return {
          ok: false,
          failure: 'TRANSIENT',
          message: 'Shiprocket accepted the order but returned no shipment id',
        };
      }
      return { ok: true, orderId: res.order_id, shipmentId: res.shipment_id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, failure: this.classify(message), message };
    }
  }

  /**
   * Not-this-address versus not-right-now.
   *
   * The distinction decides whether the AWB saga supersedes the shipment
   * and routes to manual placement, or leaves it for the next retry
   * (CUR-2b). Read from their message text, which is all they give —
   * and biased toward TRANSIENT, because retrying a parcel that could
   * never ship wastes a job, while superseding one that would have
   * shipped costs an operator a manual placement.
   */
  private classify(message: string): 'NON_SERVICEABLE' | 'TRANSIENT' {
    const m = message.toLowerCase();
    return NON_SERVICEABLE_HINTS.some((h) => m.includes(h)) ? 'NON_SERVICEABLE' : 'TRANSIENT';
  }

  async fetchLabel(
    courierShipmentId: string,
    courierAccountId: string,
  ): Promise<{ url: string | null; message: string | null }> {
    if (await this.http.isStubMode()) {
      return { url: `https://stub.local/shiprocket/label/${courierShipmentId}.pdf`, message: null };
    }
    const res = await this.http.request<ShiprocketLabelResponse>({
      method: 'POST',
      path: '/v1/external/courier/generate/label',
      // An ARRAY even for one parcel — their shape, not ours.
      body: { shipment_id: [Number(courierShipmentId)] },
      actor: this.actor(),
      courierAccountId,
    });
    return {
      url: res.label_created === 1 && res.label_url ? res.label_url : null,
      message: res.response ?? null,
    };
  }

  async checkServiceability(
    input: { pickupPincode: string; deliveryPincode: string; weightGrams: number; isCod: boolean },
    courierAccountId: string,
  ): Promise<{ serviceable: boolean; fromLiveApi: boolean }> {
    if (await this.http.isStubMode()) {
      return { serviceable: input.deliveryPincode !== '000000', fromLiveApi: false };
    }
    const res = await this.http.request<ShiprocketServiceabilityResponse>({
      method: 'GET',
      path: '/v1/external/courier/serviceability/',
      query: {
        pickup_postcode: input.pickupPincode,
        delivery_postcode: input.deliveryPincode,
        weight: input.weightGrams / 1000,
        cod: input.isCod ? 1 : 0,
      },
      actor: this.actor(),
      courierAccountId,
    });
    // Serviceable means at least one courier that is not blocked. An
    // empty list is a clear no; a list of blocked ones is the same no
    // wearing a hat.
    const couriers = res.data?.available_courier_companies ?? [];
    return { serviceable: couriers.some((c) => c.blocked !== 1), fromLiveApi: true };
  }

  /**
   * Their scan vocabulary → ours.
   *
   * Unrecognised maps to null and the caller records an unmappable scan
   * rather than guessing. Inventing a DELIVERED from an unknown string
   * is how a parcel gets marked arrived because somebody changed a case
   * label.
   */
  normalizeScan(raw: { rawStatus: string }): NormalizedScan {
    const key = raw.rawStatus.trim().toLowerCase();
    const mapped = SHIPROCKET_STATUS_MAP[key];
    if (mapped === undefined) {
      // UNMAPPABLE rather than a guess. The processor records the raw
      // scan and emits no transition — inventing a DELIVERED from an
      // unknown string is how a parcel gets marked arrived because
      // somebody changed a case label.
      return { kind: 'UNMAPPABLE', reason: `SHIPROCKET_UNKNOWN_STATUS:${raw.rawStatus}` };
    }
    return { kind: 'NORMALIZED', shipmentStatus: mapped };
  }

  async fetchTracking(
    awbNumbers: readonly string[],
    courierAccountId: string,
  ): Promise<CourierTrackingResult[]> {
    if (await this.http.isStubMode()) return [];

    const out: CourierTrackingResult[] = [];
    for (const awb of awbNumbers) {
      try {
        const res = await this.http.request<ShiprocketTrackingResponse>({
          method: 'GET',
          path: `/v1/external/courier/track/awb/${encodeURIComponent(awb)}`,
          actor: this.actor(),
          courierAccountId,
        });
        const activities = res.tracking_data?.shipment_track_activities ?? [];
        out.push({
          awbNumber: awb,
          scans: activities
            .filter((a) => typeof a.status === 'string' || typeof a['sr-status-label'] === 'string')
            .map((a) => ({
              awbNumber: awb,
              // Prefer their normalised label over the free-text
              // activity: the label is the one they keep stable.
              rawStatus: a['sr-status-label'] ?? a.status ?? '',
              // Their timestamps carry no zone and are IST — the same
              // trap Delhivery's had, and the same shared helper fixes
              // it rather than a second copy of the parsing.
              eventAtIso: toIsoWithIst(a.date ?? ''),
              locationName: a.location ?? null,
              description: a.activity ?? null,
            })),
        });
      } catch (err) {
        // One AWB's failure must not lose the rest of the batch.
        this.logger.warn(
          { awb, err: err instanceof Error ? err.message : String(err) },
          'Shiprocket tracking lookup failed for one AWB',
        );
      }
    }
    return out;
  }

  async cancelShipment(
    awbNumber: string,
    courierAccountId: string,
  ): Promise<{ ok: boolean; message: string | null }> {
    if (await this.http.isStubMode()) return { ok: true, message: 'stub' };
    const res = await this.http.request<{ message?: string }>({
      method: 'POST',
      path: '/v1/external/orders/cancel/shipment/awbs',
      body: { awbs: [awbNumber] },
      actor: this.actor(),
      courierAccountId,
    });
    // Their cancel is ASYNCHRONOUS — the reply says the request is in
    // progress, not that the parcel stopped. CUR-11 already holds here:
    // their scans decide where the parcel is, not this response.
    return { ok: true, message: res.message ?? null };
  }

  async requestPickup(
    courierShipmentId: string,
    courierAccountId: string,
  ): Promise<{ ok: boolean; message: string | null }> {
    if (await this.http.isStubMode()) return { ok: true, message: 'stub' };
    const res = await this.http.request<{ pickup_status?: number; response?: unknown }>({
      method: 'POST',
      path: '/v1/external/courier/generate/pickup',
      body: { shipment_id: [Number(courierShipmentId)] },
      actor: this.actor(),
      courierAccountId,
    });
    return { ok: res.pickup_status === 1, message: null };
  }

  /** Deterministic, and keyed the same way Delhivery's stub is. */
  private stubAwb(req: ShiprocketAwbRequest): ShiprocketAwbResult {
    if (req.recipient.pincode === '999999') {
      return { ok: false, failure: 'TRANSIENT', message: 'stub: transient failure' };
    }
    if (req.recipient.pincode === '000000') {
      return { ok: false, failure: 'NON_SERVICEABLE', message: 'stub: pincode not serviceable' };
    }
    const seed = req.shipmentId.replace(/\D/g, '').slice(-8).padStart(8, '0');
    return {
      ok: true,
      awbNumber: `SR${seed}`,
      courierShipmentId: `9${seed}`,
      courierOrderId: `8${seed}`,
      courierName: 'Stub Courier',
    };
  }
}
