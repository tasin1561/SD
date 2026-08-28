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
import { CourierWriteGuardService } from '../../courier-shared/services/courier-write-guard.service';
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
/**
 * Their ETD is sometimes working days as a number and sometimes a
 * delivery DATE as a string, in the same field. Both are turned into
 * days-from-now, and anything unrecognised becomes null rather than a
 * guess — a wrong promised date reaches the customer.
 */
function parseEtdDays(c: {
  readonly etd?: string;
  readonly estimated_delivery_days?: string | number;
}): number | null {
  const days = c.estimated_delivery_days;
  if (typeof days === 'number' && Number.isFinite(days)) return Math.max(0, Math.round(days));
  if (typeof days === 'string' && /^\d+$/.test(days.trim())) return Number(days.trim());

  const etd = c.etd?.trim() ?? '';
  if (etd === '') return null;
  const parsed = Date.parse(etd);
  if (Number.isNaN(parsed)) return null;
  const diffDays = Math.ceil((parsed - Date.now()) / 86_400_000);
  return diffDays < 0 ? null : diffDays;
}

@Injectable()
export class ShiprocketClientService {
  private readonly logger = new Logger(ShiprocketClientService.name);

  constructor(
    private readonly http: ShiprocketHttpService,
    private readonly writeGuard: CourierWriteGuardService,
  ) {}

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

    // Manifests a real parcel Shiprocket now expects to collect. The
    // guard sits before createOrder rather than before the AWB assign,
    // because the ORDER is the thing that becomes real — a created
    // order with no AWB is still a row on their side that somebody has
    // to go and cancel.
    await this.writeGuard.assertWritable('shiprocket', 'shipment.create', {
      shipmentId: req.shipmentId,
      orderNumber: req.orderNumber,
    });

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

  /**
   * What this lane would cost and how long it would take.
   *
   * ONE call, because that is how they package it: their serviceability
   * response carries the rate and the ETD per courier company. Delhivery
   * splits the same two facts across a TAT endpoint and a cost endpoint,
   * which is why the layer above keeps them as separate fields — the
   * split is Delhivery's shape, not a property of the question.
   *
   * The CHEAPEST unblocked option is the answer. Shiprocket aggregates
   * many carriers and picks at assignment time; quoting the first in an
   * unordered list would report a number we would not have paid.
   */
  async estimateLane(
    input: {
      readonly pickupPincode: string;
      readonly deliveryPincode: string;
      readonly weightGrams: number;
      readonly isCod: boolean;
    },
    courierAccountId: string,
  ): Promise<{
    readonly etdDays: number | null;
    readonly totalInr: number | null;
    readonly carrierName: string | null;
    readonly fromLiveApi: boolean;
  }> {
    if (await this.http.isStubMode()) {
      return { etdDays: null, totalInr: null, carrierName: null, fromLiveApi: false };
    }
    const res = await this.http.request<ShiprocketServiceabilityResponse>({
      method: 'GET',
      path: '/v1/external/courier/serviceability/',
      query: {
        pickup_postcode: input.pickupPincode,
        delivery_postcode: input.deliveryPincode,
        // Kilograms, not grams — their unit, and getting it wrong by a
        // factor of a thousand returns a plausible-looking wrong price.
        weight: input.weightGrams / 1000,
        cod: input.isCod ? 1 : 0,
      },
      actor: this.actor(),
      courierAccountId,
    });

    const options = (res.data?.available_courier_companies ?? []).filter((c) => c.blocked !== 1);
    if (options.length === 0) {
      return { etdDays: null, totalInr: null, carrierName: null, fromLiveApi: true };
    }
    const rate = (c: (typeof options)[number]): number =>
      c.rate ?? (c.freight_charge ?? 0) + (c.cod_charges ?? 0) + (c.other_charges ?? 0);
    let best = options[0];
    if (best === undefined) {
      return { etdDays: null, totalInr: null, carrierName: null, fromLiveApi: true };
    }
    for (const c of options) if (rate(c) < rate(best)) best = c;

    return {
      etdDays: parseEtdDays(best),
      totalInr: rate(best) > 0 ? rate(best) : null,
      carrierName: best.courier_name,
      fromLiveApi: true,
    };
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

  /**
   * Proof of delivery.
   *
   * Shiprocket exposes ONE document — the POD — where Delhivery has
   * four. The layer above maps its EPOD request onto this and refuses
   * the other three rather than returning the POD for all of them: a
   * signature image and a reverse-pickup QC photo are different
   * evidence, and handing back the wrong one labelled as the right one
   * is worse than saying we do not have it.
   *
   * A null url is the normal answer before delivery, not an error.
   */
  async fetchPod(
    courierShipmentId: string,
    courierAccountId: string,
  ): Promise<{ url: string | null; message: string | null }> {
    if (await this.http.isStubMode()) {
      return { url: `https://stub.local/shiprocket/pod/${courierShipmentId}.pdf`, message: 'stub' };
    }
    const res = await this.http.request<{
      data?: { pod?: string | null; pod_url?: string | null };
      message?: string;
    }>({
      method: 'GET',
      path: `/v1/external/shipments/${encodeURIComponent(courierShipmentId)}`,
      actor: this.actor(),
      courierAccountId,
    });
    const url = res.data?.pod_url ?? res.data?.pod ?? null;
    return {
      url: typeof url === 'string' && url.trim() !== '' ? url : null,
      message: res.message ?? null,
    };
  }

  /**
   * Correct the consignee details on a live parcel.
   *
   * ── WHAT THEY WILL AND WILL NOT CHANGE ───────────────────────────
   * Name, phone and address, yes. Payment mode, NO — Shiprocket has no
   * prepaid↔COD conversion, and the amount to collect is fixed when the
   * order is created. Delhivery does convert, so the layer above refuses
   * that half here rather than sending an edit that silently drops the
   * only field the operator cared about.
   *
   * Their endpoint takes THEIR order id, not the AWB.
   */
  async editShipment(
    input: {
      readonly courierShipmentId: string;
      readonly name?: string;
      readonly phone?: string;
      readonly address?: string;
      readonly city?: string;
      readonly pincode?: string;
    },
    courierAccountId: string,
  ): Promise<{ ok: boolean; message: string | null }> {
    if (await this.http.isStubMode()) return { ok: true, message: 'stub' };
    // Changes where a real van goes.
    await this.writeGuard.assertWritable('shiprocket', 'shipment.edit', {
      courierShipmentId: input.courierShipmentId,
    });
    const res = await this.http.request<{ message?: string; status?: number }>({
      method: 'POST',
      path: '/v1/external/orders/address/update',
      body: {
        order_id: input.courierShipmentId,
        ...(input.name === undefined ? {} : { shipping_customer_name: input.name }),
        ...(input.phone === undefined
          ? {}
          : { shipping_phone: input.phone.replace(/^\+91/, '').replace(/\D/g, '').slice(-10) }),
        ...(input.address === undefined ? {} : { shipping_address: input.address }),
        ...(input.city === undefined ? {} : { shipping_city: input.city }),
        ...(input.pincode === undefined ? {} : { shipping_pincode: input.pincode }),
      },
      actor: this.actor(),
      courierAccountId,
    });
    return { ok: res.status !== 0, message: res.message ?? null };
  }

  async cancelShipment(
    awbNumber: string,
    courierAccountId: string,
  ): Promise<{ ok: boolean; message: string | null }> {
    if (await this.http.isStubMode()) return { ok: true, message: 'stub' };
    // Turns a moving parcel into a return, and reaches the customer.
    await this.writeGuard.assertWritable('shiprocket', 'shipment.cancel', { awbNumber });
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
    // Sends a real van to a real warehouse.
    await this.writeGuard.assertWritable('shiprocket', 'pickup.request', { courierShipmentId });
    const res = await this.http.request<{ pickup_status?: number; response?: unknown }>({
      method: 'POST',
      path: '/v1/external/courier/generate/pickup',
      body: { shipment_id: [Number(courierShipmentId)] },
      actor: this.actor(),
      courierAccountId,
    });
    return { ok: res.pickup_status === 1, message: null };
  }

  /**
   * Register a pickup location.
   *
   * ── WHY THIS IS NOT OPTIONAL ─────────────────────────────────────
   * Every order we create names a `pickup_location`, and Shiprocket
   * matches it against the locations registered on that account. An
   * unregistered name is not a warning — the order create fails, so a
   * warehouse nobody registered is a warehouse that cannot ship. The
   * same trap as Delhivery's, and for the same reason it is worth
   * saying twice: the name is matched EXACTLY.
   *
   * Their API returns the location's numeric id, which nothing else of
   * ours keys on — the name is the identifier everywhere it matters.
   */
  async registerPickupLocation(
    input: {
      readonly name: string;
      readonly phone: string;
      readonly pin: string;
      readonly address: string;
      readonly city: string;
      readonly state: string;
      readonly country: string;
      readonly email: string;
    },
    courierAccountId: string,
  ): Promise<{ success: boolean; name: string; message: string | null }> {
    if (await this.http.isStubMode()) {
      return { success: true, name: input.name, message: 'stub' };
    }
    await this.writeGuard.assertWritable('shiprocket', 'warehouse.write', {
      operation: 'create',
      name: input.name,
    });
    const res = await this.http.request<{ success?: boolean; message?: string }>({
      method: 'POST',
      path: '/v1/external/settings/company/addpickup',
      body: {
        pickup_location: input.name,
        name: input.name,
        email: input.email,
        // Bare ten digits: their validator rejects a +91 prefix, the
        // same normalisation the AWB path already does.
        phone: input.phone.replace(/^\+91/, '').replace(/\D/g, '').slice(-10),
        address: input.address,
        city: input.city,
        state: input.state,
        country: input.country,
        pin_code: input.pin,
      },
      actor: this.actor(),
      courierAccountId,
    });
    return {
      success: res.success !== false,
      name: input.name,
      message: res.message ?? null,
    };
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
