import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
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
  type ShiprocketCreateReturnRequest,
  type ShiprocketCreateReturnResponse,
  type ShiprocketReturnAddress,
  type ShiprocketLabelResponse,
  type ShiprocketServiceabilityResponse,
  type ShiprocketTrackingResponse,
} from '../types/shiprocket.types';
import { parseIstTimestamp } from '../../tracking-events/services/courier-time';
import type { CourierOption } from '../../courier-shared/services/courier-option-selection.service';
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
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The pickup location this ACCOUNT registered with Shiprocket, by name.
   *
   * Shiprocket matches `pickup_location` against the names registered on
   * the account, exactly — so it has to be THEIR name ("warehouse"), read
   * from the account it will be booked on. The booking used to be handed
   * our internal warehouse id here, a UUID no Shiprocket account has ever
   * registered, so every real booking would have been refused. Delhivery
   * never noticed because it resolves its own name the same way this now
   * does. Null when neither the account nor the setting has one.
   *
   * ── AND THE SETTING IS SHIPROCKET'S OWN ──────────────────────────
   * `courier.shiprocket_pickup_location`, the sibling of Delhivery's.
   * The account's own name still wins; the setting is the fallback for
   * a single-account setup, which is the shape every other
   * `courier.<code>_*` switch already has. Falling back to DELHIVERY's
   * key would send a name registered with one company to the other.
   */
  private async pickupLocationName(courierAccountId: string): Promise<string | null> {
    const row = await this.prisma.client.courierAccount.findUnique({
      where: { id: courierAccountId },
      select: { pickupLocationName: true },
    });
    const name = (row?.pickupLocationName ?? '').trim();
    if (name !== '') return name;

    const setting = await this.prisma.client.systemSetting.findUnique({
      where: { key: 'courier.shiprocket_pickup_location' },
      select: { valueString: true },
    });
    const fallback = (setting?.valueString ?? '').trim();
    return fallback === '' ? null : fallback;
  }

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
    /**
     * WHICH carrier to assign, when a policy already decided.
     *
     * Omitted, Shiprocket ranks and picks — which is correct when the
     * seller asked for that, and only then. Passing an id makes the
     * booking honour the option an operator was actually shown; without
     * it a MANUAL choice would be presented, chosen, and then silently
     * overridden at assignment by whatever their ranking preferred.
     */
    courierCompanyId?: number,
  ): Promise<ShiprocketAwbResult> {
    if (await this.http.isStubMode()) return this.stubAwb(req);

    /*
      ── A RETURN IS A DIFFERENT CALL, NOT A FLAG ON THIS ONE ────────

      `/orders/create/return` rather than `/orders/create/adhoc`, and the
      address naming inverts: the customer is the PICKUP and we are the
      SHIPPING side. It also needs OUR address spelled out, which a
      forward booking never does (a registered pickup-location name is
      enough there).

      Split out before the pickup-location lookup because a return does
      not use one — demanding it would refuse a collection for a setting
      that has nothing to do with it, which is the same mistake the
      pickup service had.
    */
    if (req.isReverse === true) {
      return this.createReturn(req, courierAccountId, courierCompanyId);
    }

    // A setup gap, not an opinion about the parcel: TRANSIENT, so it is
    // neither failed over nor pushed to manual placement, and the
    // waybill watchdog names it until somebody records the name.
    const pickupLocationName = await this.pickupLocationName(courierAccountId);
    if (pickupLocationName === null) {
      return {
        ok: false,
        failure: 'TRANSIENT',
        message:
          'PICKUP_LOCATION_NOT_CONFIGURED: this Shiprocket account has no pickup location name. ' +
          'Record the exact name registered on Shiprocket (Settings → Pickup Addresses) on the ' +
          'courier account before booking.',
      };
    }

    // Manifests a real parcel Shiprocket now expects to collect. The
    // guard sits before createOrder rather than before the AWB assign,
    // because the ORDER is the thing that becomes real — a created
    // order with no AWB is still a row on their side that somebody has
    // to go and cancel.
    await this.writeGuard.assertWritable('shiprocket', 'shipment.create', {
      shipmentId: req.shipmentId,
      orderNumber: req.orderNumber,
    });

    const created = await this.createOrder(req, courierAccountId, pickupLocationName);
    if (!created.ok) return created;

    try {
      const assigned = await this.http.request<ShiprocketAssignAwbResponse>({
        method: 'POST',
        path: '/v1/external/courier/assign/awb',
        body:
          courierCompanyId === undefined
            ? { shipment_id: created.shipmentId }
            : { shipment_id: created.shipmentId, courier_id: courierCompanyId },
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

  /**
   * WHERE A RETURN IS DELIVERED TO — our warehouse, as ops recorded it.
   *
   * Read from `courier.shiprocket_return_address` (JSON), seeded EMPTY.
   * Never guessed and never derived from the pickup-location NAME: that
   * name is a label registered on their side and carries no address we
   * can read back, and a return delivered to an address we invented is
   * somebody's goods going to a place that does not exist.
   *
   * Null when unset or incomplete, which the caller reports as a setup
   * gap (TRANSIENT) rather than as the courier refusing the parcel.
   */
  private async returnAddress(): Promise<ShiprocketReturnAddress | null> {
    const row = await this.prisma.client.systemSetting
      .findUnique({
        where: { key: 'courier.shiprocket_return_address' },
        select: { valueJson: true },
      })
      .catch(() => null);

    const raw: unknown = row?.valueJson ?? null;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    const str = (k: string): string => (typeof o[k] === 'string' ? (o[k] as string).trim() : '');

    const addr: ShiprocketReturnAddress = {
      name: str('name'),
      addressLine1: str('addressLine1'),
      addressLine2: str('addressLine2'),
      city: str('city'),
      state: str('state'),
      pincode: str('pincode'),
      phone: str('phone'),
      email: str('email'),
    };
    // Every field their return create validates. A partial address is
    // refused here rather than at their end, where the message would be
    // about one field and give no hint that the SETTING is half filled.
    const required = [
      addr.name,
      addr.addressLine1,
      addr.city,
      addr.state,
      addr.pincode,
      addr.phone,
    ];
    return required.some((v) => v === '') ? null : addr;
  }

  /**
   * Book the RETURN leg with Shiprocket.
   *
   * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────
   * It did not, and `CourierAwbDispatchService` answered
   * `REVERSE_NOT_SUPPORTED` — so a customer return on a Shiprocket
   * parcel could never be collected: `ReversePickupBookingService`
   * raised a HIGH issue and the goods stayed with the customer. The
   * owner's call is that the courier who delivered it collects it: one
   * account, one cost trail, one parcel's history.
   *
   * ── SAME TWO STEPS, SAME SEAM, SAME REASONING ───────────────────
   * Create then assign, exactly as the forward path — including NOT
   * retrying the create when the assign fails, because a retry makes a
   * second return order for one parcel and two vans is worse than one
   * orphaned row an operator can see in their dashboard.
   *
   * ── WHAT IS NOT PROVEN ──────────────────────────────────────────
   * No return has been booked on this account. The request shape is
   * their documented one and every field here is one they name; what has
   * NOT been observed is whether their AWB assign needs `is_return` for
   * a return shipment id (we send it — see the note at the call), and
   * whether omitting `qc_enable` differs from sending it false. Both are
   * marked below rather than quietly assumed.
   */
  private async createReturn(
    req: ShiprocketAwbRequest,
    courierAccountId: string,
    courierCompanyId?: number,
  ): Promise<ShiprocketAwbResult> {
    const destination = await this.returnAddress();
    if (destination === null) {
      // A SETUP gap, not an opinion about the parcel — same
      // classification as a missing pickup location on the forward path,
      // so it is neither failed over nor pushed to manual placement and
      // a retry after somebody fills the setting in simply works.
      return {
        ok: false,
        failure: 'TRANSIENT',
        message:
          'SHIPROCKET_RETURN_ADDRESS_NOT_CONFIGURED: a return needs the address it comes back TO, ' +
          'and `courier.shiprocket_return_address` is unset or incomplete. Set it on /settings ' +
          '(name, addressLine1, city, state, pincode, phone — addressLine2 and email optional).',
      };
    }

    if (req.items.length === 0) {
      // Their return create validates `order_items`, and an empty one is
      // refused. Named here because the message they send back is about
      // a field, and the real answer is "this parcel has no line
      // snapshot" — which is a data problem on our side.
      return {
        ok: false,
        failure: 'TRANSIENT',
        message:
          'SHIPROCKET_RETURN_NEEDS_ITEMS: Shiprocket will not create a return with no lines, and ' +
          'this parcel carries no item snapshot to send.',
      };
    }

    // A van is about to be sent to a customer's door. Same guard, same
    // placement as the forward create: before the ORDER exists on their
    // side, because that is the row somebody would have to go and cancel.
    await this.writeGuard.assertWritable('shiprocket', 'shipment.create', {
      shipmentId: req.shipmentId,
      orderNumber: req.orderNumber,
      reverse: true,
    });

    const [firstName, ...rest] = req.recipient.name.trim().split(/\s+/);
    const [destFirst, ...destRest] = destination.name.trim().split(/\s+/);
    const body: ShiprocketCreateReturnRequest = {
      order_id: req.orderNumber,
      order_date: new Date().toISOString().slice(0, 19).replace('T', ' '),
      // PICKUP = the customer. Inverted from the forward create, which
      // is the one thing about this endpoint that is easy to get wrong
      // and impossible to notice: a swapped pair books a van to our own
      // warehouse while the customer keeps the goods.
      pickup_customer_name: firstName ?? req.recipient.name,
      pickup_last_name: rest.length > 0 ? rest.join(' ') : (firstName ?? ''),
      pickup_address: req.recipient.addressLine1,
      pickup_address_2: req.recipient.addressLine2,
      pickup_city: req.recipient.city,
      pickup_state: req.recipient.state,
      pickup_country: 'India',
      pickup_pincode: Number(req.recipient.pincode),
      pickup_email: req.recipient.email ?? '',
      // A bare ten-digit number, as on the forward create.
      pickup_phone: req.recipient.phoneE164.replace(/^\+91/, '').replace(/\D/g, ''),
      pickup_isd_code: '91',
      // SHIPPING = us.
      shipping_customer_name: destFirst ?? destination.name,
      shipping_last_name: destRest.length > 0 ? destRest.join(' ') : (destFirst ?? ''),
      shipping_address: destination.addressLine1,
      shipping_address_2: destination.addressLine2,
      shipping_city: destination.city,
      shipping_country: 'India',
      shipping_pincode: Number(destination.pincode),
      shipping_state: destination.state,
      shipping_email: destination.email,
      shipping_isd_code: '91',
      shipping_phone: destination.phone.replace(/^\+91/, '').replace(/\D/g, ''),
      order_items: req.items.map((i) => ({
        name: i.name,
        sku: i.sku,
        units: i.quantity,
        selling_price: i.unitPriceInr,
        discount: '0',
        // See the type's note: we have no QC process to feed or to act
        // on, and an unread check delays every collection.
        qc_enable: false,
      })),
      // A return collects nothing from the customer, whatever the
      // outbound leg was — sending COD here would ask them to pay for
      // their own return.
      payment_method: 'PREPAID',
      total_discount: '0',
      sub_total: req.subTotalInr,
      length: req.lengthCm,
      breadth: req.breadthCm,
      height: req.heightCm,
      weight: req.weightGrams / 1000,
    };

    let created: ShiprocketCreateReturnResponse;
    try {
      created = await this.http.request<ShiprocketCreateReturnResponse>({
        method: 'POST',
        path: '/v1/external/orders/create/return',
        body,
        actor: this.actor(),
        courierAccountId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, failure: this.classify(message), message };
    }

    if (typeof created.shipment_id !== 'number' || created.shipment_id === 0) {
      return {
        ok: false,
        failure: 'TRANSIENT',
        message: 'Shiprocket accepted the return but returned no shipment id',
      };
    }

    try {
      const assigned = await this.http.request<ShiprocketAssignAwbResponse>({
        method: 'POST',
        path: '/v1/external/courier/assign/awb',
        body: {
          shipment_id: created.shipment_id,
          // THEIR documented flag for a return shipment. NOT verified
          // against a live booking — no return has been placed on this
          // account — so if a first real collection is refused here,
          // this field is the first thing to check.
          is_return: 1,
          ...(courierCompanyId === undefined ? {} : { courier_id: courierCompanyId }),
        },
        actor: this.actor(),
        courierAccountId,
      });

      const awb = assigned.response?.data?.awb_code;
      if (assigned.awb_assign_status !== 1 || typeof awb !== 'string' || awb === '') {
        const message =
          assigned.message ?? 'Shiprocket assigned no AWB to the return and gave no reason';
        return { ok: false, failure: this.classify(message), message };
      }
      return {
        ok: true,
        awbNumber: awb,
        courierShipmentId: String(created.shipment_id),
        courierOrderId: String(created.order_id),
        courierName: assigned.response?.data?.courier_name ?? null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { orderNumber: req.orderNumber, shipmentId: created.shipment_id, message },
        'Shiprocket created the RETURN order but would not assign an AWB',
      );
      return { ok: false, failure: this.classify(message), message };
    }
  }

  private async createOrder(
    req: ShiprocketAwbRequest,
    courierAccountId: string,
    pickupLocationName: string,
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
      pickup_location: pickupLocationName,
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
      // RS-10: a reseller store's name; absent for every other order.
      ...(req.resellerName === undefined ? {} : { reseller_name: req.resellerName }),
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
  /**
   * Did they REFUSE the parcel, or ask us to come back later?
   *
   * CUR-13, applied to Shiprocket (2026-09-09). This defaulted every
   * unrecognised message to TRANSIENT — the same shape Delhivery's
   * classifier had before 2026-09-02, and wrong for the same reason: a
   * refusal that gets the answer a timeout gets is retried forever,
   * never fails over, and nobody is told.
   *
   * A live booking found it. Shiprocket answered
   * `422 {"message":"Phone number is in invalid format"}` and we
   * classified it TRANSIENT, so BullMQ would have retried a call that
   * fails identically every single time.
   *
   * The status code is the honest signal, and it is one we already have:
   * a 4xx is Shiprocket having FORMED AN OPINION about this parcel's
   * data, which tomorrow's attempt will not change. 408 and 429 are the
   * exceptions — those genuinely mean "later" — and 5xx is their
   * problem, not the parcel's.
   *
   * Word-matching stays only as a fallback for the errors that carry no
   * status (a socket timeout, a DNS failure), never as the primary test:
   * classifying on which words an opinion used is what CUR-13 says not
   * to do.
   */
  private classify(message: string): 'NON_SERVICEABLE' | 'TRANSIENT' {
    const status = /failed \((\d{3})\)/.exec(message)?.[1];
    if (status !== undefined) {
      const code = Number(status);
      if (code === 408 || code === 429) return 'TRANSIENT';
      if (code >= 400 && code < 500) return 'NON_SERVICEABLE';
      return 'TRANSIENT';
    }
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
   * EVERY courier the carrier would accept for this parcel, not just
   * the cheapest.
   *
   * `estimateLane` answers "what will this cost" and collapses the list
   * to one number, which is right for a margin report and wrong for a
   * choice: an operator picking a courier needs to see the ones they
   * are not picking. Same endpoint, no collapse.
   *
   * A BLOCKED courier is dropped rather than shown greyed out — it is
   * not an option, and offering it means an operator can choose
   * something the assign call will refuse.
   */
  async listCourierOptions(
    input: {
      readonly pickupPincode: string;
      readonly deliveryPincode: string;
      readonly weightGrams: number;
      readonly isCod: boolean;
    },
    courierAccountId: string,
  ): Promise<{ readonly options: CourierOption[]; readonly fromLiveApi: boolean }> {
    if (await this.http.isStubMode()) return { options: [], fromLiveApi: false };

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

    const options = (res.data?.available_courier_companies ?? [])
      .filter((c) => c.blocked !== 1)
      .map((c) => ({
        courierCompanyId: c.courier_company_id,
        courierName: c.courier_name,
        // Their `rate` is the all-in figure; the parts are the fallback
        // for responses that omit it. A zero total is reported as zero
        // rather than as null — free is a price, unknown is not.
        rateInr: c.rate ?? (c.freight_charge ?? 0) + (c.cod_charges ?? 0) + (c.other_charges ?? 0),
        estimatedDays: parseEtdDays(c),
        etd: c.etd ?? null,
      }));

    return { options, fromLiveApi: true };
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
        let unreadable = 0;
        const scans = activities.flatMap((a) => {
          if (typeof a.status !== 'string' && typeof a['sr-status-label'] !== 'string') return [];
          // Their timestamps carry no zone and are IST, and the webhook's
          // arrive DAY-first — parsed by the one helper both paths share.
          // A scan whose time cannot be read is DROPPED, never stamped
          // with now (TRK-3): an empty date used to become '' and then an
          // Invalid Date downstream.
          const eventAtIso = parseIstTimestamp(a.date);
          if (eventAtIso === null) {
            unreadable += 1;
            return [];
          }
          return [
            {
              awbNumber: awb,
              // Prefer their normalised label over the free-text
              // activity: the label is the one they keep stable.
              rawStatus: a['sr-status-label'] ?? a.status ?? '',
              eventAtIso,
              locationName: a.location ?? null,
              description: a.activity ?? null,
            },
          ];
        });
        if (unreadable > 0) {
          this.logger.warn(
            { awb, unreadable },
            'Shiprocket tracking returned scans with an unreadable date; they were skipped',
          );
        }
        out.push({ awbNumber: awb, scans });
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
      /** THEIR order id. Their parcel id is refused as invalid. */
      readonly courierOrderId: string;
      /** The destination as it stands, to merge the changes over —
       *  their endpoint validates the whole block, not a patch. */
      readonly current: {
        readonly name: string;
        readonly addressLine1: string;
        readonly addressLine2: string | null;
        readonly city: string;
        readonly stateProvince: string;
        readonly postalCode: string;
        readonly phoneE164: string;
        readonly email: string | null;
      };
      readonly name?: string;
      readonly phone?: string;
      readonly address?: string;
      readonly city?: string;
      readonly pincode?: string;
    },
    courierAccountId: string,
  ): Promise<{ ok: boolean; message: string | null }> {
    if (await this.http.isStubMode()) return { ok: true, message: 'stub' };
    /*
      THEIR ORDER ID, AND THE WHOLE SHIPPING BLOCK.

      Measured against the live API on 2026-09-09, and this had never
      once worked:

        order_id = our courierShipmentId (their PARCEL id)
          → 422 "The selected order id is invalid."
        order_id = their ORDER id, partial body
          → 422 "The shipping country field is required."
        order_id = their ORDER id, complete block, before a waybill
          → 202, and the change is there on the next read
        anything at all once the parcel is READY TO SHIP
          → 400 "you can only change address 1 or address 2 as order is
            already in READY TO SHIP status" — misleading, because it
            refuses an address-lines-only edit too

      So: keyed on `courierOrderId` (the field that only started being
      persisted the same day), and the caller passes the CURRENT
      destination so the changed fields can be merged over it. This is
      not a patch endpoint and treating it as one is what produced the
      422.
    */
    // Changes where a real van goes.
    await this.writeGuard.assertWritable('shiprocket', 'shipment.edit', {
      courierOrderId: input.courierOrderId,
    });
    const d = input.current;
    const res = await this.http.request<{ message?: string; status?: number }>({
      method: 'POST',
      path: '/v1/external/orders/address/update',
      body: {
        order_id: input.courierOrderId,
        shipping_customer_name: input.name ?? d.name,
        shipping_last_name: '',
        shipping_address: input.address ?? d.addressLine1,
        shipping_address_2: d.addressLine2 ?? '',
        shipping_city: input.city ?? d.city,
        shipping_state: d.stateProvince,
        // They require it and reject the body without it. India-only in
        // Phase 1A, and the shipment carries no country on the snapshot.
        shipping_country: 'India',
        shipping_pincode: input.pincode ?? d.postalCode,
        shipping_email: d.email ?? '',
        shipping_phone: (input.phone ?? d.phoneE164)
          .replace(/^\+91/, '')
          .replace(/\D/g, '')
          .slice(-10),
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
