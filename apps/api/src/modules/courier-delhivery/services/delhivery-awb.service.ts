import { Injectable, Logger } from '@nestjs/common';
import type { CourierCredentialActor } from '../../courier-shared/services/courier-credential.service';
import { PaymentMode } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { DelhiveryHttpService } from './delhivery-http.service';
import { DelhiveryWriteGuardService } from './delhivery-write-guard.service';
import { DelhiveryServiceabilityService } from './delhivery-serviceability.service';
import type {
  DelhiveryAwbRequest,
  DelhiveryAwbResult,
  DelhiveryClient,
} from '../types/delhivery.types';

/**
 * Module 9 — Delhivery AWB generation. Implements the `generateAwb`
 * slice of the `DelhiveryClient` adapter interface.
 *
 * ── STUB MODE (default) ────────────────────────────────────────────
 * When DelhiveryHttpService reports stub mode (empty
 * `courier.delhivery_api_base_url`), `generateAwb` returns a
 * DETERMINISTIC mock result with NO network call. Keyed on the
 * destination postal code so e2e can drive every branch:
 *
 *   - postalCode '000000' → non-serviceable failure → CUR-5 auto-supersede
 *   - postalCode '999999' → transient courier failure → CUR-2 retry
 *   - any other postalCode → success: awbNumber `DLVSTUB<digits>`
 *
 * ── REAL MODE ──────────────────────────────────────────────────────
 * Marshals to Delhivery's `POST /api/cmu/create.json` per the public
 * documentation at https://track.delhivery.com/api/.
 *
 * Body shape (form-data-key encoded): `format=json&data=<JSON>` where
 * JSON is `{ shipments: [...], pickup_location: { name } }`. The
 * pickup_location.name MUST be a warehouse name pre-registered in
 * Delhivery's partner portal — we resolve it from
 * `system_settings.courier.delhivery_pickup_location`.
 *
 * Response success: `{ success: true, packages: [{ waybill, refnum, ... }] }`
 * Response failure: `{ success: false, rmk: "ServiceableArea: ...", ... }`
 *
 * Wire-format unverified against the live sandbox; the sandbox-smoke
 * will surface any field-name drift as a normal HTTP error in the log.
 */

interface DelhiveryCreatePackage {
  waybill?: string;
  refnum?: string;
  status?: string;
  remarks?: string[];
  pdf_download_link?: string;
}

interface DelhiveryCreateResponse {
  success?: boolean;
  rmk?: string;
  packages?: DelhiveryCreatePackage[];
}

/**
 * `+919876543210` → `9876543210`.
 *
 * Delhivery's B2C create API takes the national number. Ours are stored
 * E.164 (validated at the app boundary), so the prefix has to come off
 * at the wire, not in the database — the stored value is still the one
 * an agent dials and the one a webhook matches on.
 *
 * Deliberately conservative: anything that is not +91 followed by
 * exactly ten digits is returned unchanged, because a refused shipment
 * is recoverable and a mangled phone number on a manifested parcel is
 * not.
 */
export function toNationalPhone(e164: string): string {
  const m = /^\+91(\d{10})$/.exec(e164.trim());
  return m?.[1] ?? e164.trim();
}

@Injectable()
export class DelhiveryAwbService implements Pick<DelhiveryClient, 'generateAwb'> {
  private readonly logger = new Logger(DelhiveryAwbService.name);

  constructor(
    private readonly http: DelhiveryHttpService,
    private readonly prisma: PrismaService,
    private readonly writeGuard: DelhiveryWriteGuardService,
    private readonly serviceability: DelhiveryServiceabilityService,
  ) {}

  async generateAwb(
    req: DelhiveryAwbRequest,
    actor?: CourierCredentialActor,
    courierAccountId?: string | null,
  ): Promise<DelhiveryAwbResult> {
    if (await this.http.isStubMode()) {
      return this.stubGenerateAwb(req);
    }

    // ── PRE-FLIGHT SERVICEABILITY (D4) ────────────────────────────────
    // CUR-5 made this REACTIVE: let the create call fail and treat the
    // rejection as the signal. That was right against a stub. Against the
    // real network it is not: Delhivery's own FAQ says checking first is
    // mandatory, because an unserviceable pin still MANIFESTS — the parcel
    // is created, marked NSZ, and returned to us at our cost. Better to
    // spend a free read than a paid round trip.
    //
    // A serviceability check that itself fails does NOT block the
    // shipment: we fall through to the create call and let Delhivery be
    // the authority, which is the old reactive behaviour and the right
    // fallback when the pre-flight is the thing that is broken.
    const preflight = await this.preflightServiceability(req);
    if ('blocked' in preflight) return preflight.blocked;

    const pickupLocationName = await this.resolvePickupLocationName(courierAccountId ?? null);
    const envelope = {
      shipments: [this.buildShipment(req, preflight)],
      pickup_location: { name: pickupLocationName },
    };

    // No sandbox exists for this account, so this call manifests a REAL
    // parcel that Delhivery will come to collect. The guard makes that a
    // deliberate act rather than something a retrying worker can do by
    // accident (see DelhiveryWriteGuardService).
    await this.writeGuard.assertWritable('shipment.create', {
      shipmentNumber: req.shipmentNumber,
      destinationPin: req.postalCode,
    });

    try {
      const response = await this.http.request<DelhiveryCreateResponse>({
        actor,
        method: 'POST',
        path: '/api/cmu/create.json',
        endpoint: 'create',
        body: envelope,
        encoding: 'form-data-key',
      });
      return this.parseCreateResponse(response);
    } catch (err) {
      // Network / 5xx → transient (CUR-2 retries).
      this.logger.warn(
        { shipmentNumber: req.shipmentNumber, err: (err as Error).message },
        'Delhivery create-shipment failed',
      );
      return {
        ok: false,
        serviceable: true,
        errorCode: 'DELHIVERY_TRANSPORT_ERROR',
        errorMessage: (err as Error).message,
      };
    }
  }

  /**
   * Returns a failure result when the destination cannot take this
   * parcel, or `null` to proceed. Never throws — a broken pre-flight
   * must not stop shipping.
   */
  private async preflightServiceability(
    req: DelhiveryAwbRequest,
  ): Promise<{ blocked: DelhiveryAwbResult } | { city: string; state: string }> {
    try {
      const check = await this.serviceability.canShip({
        pincode: req.postalCode,
        paymentMode: req.codAmountInr !== null ? PaymentMode.COD : PaymentMode.PREPAID,
        ...(req.codAmountInr !== null ? { codAmountInr: Number(req.codAmountInr) } : {}),
        weightGrams: req.totalWeightGrams,
      });
      if (check.ok) {
        if (check.detail.outOfDeliveryArea) {
          // Not a blocker — ODA is reachable, just slower and surcharged.
          // Worth a log so a pattern of ODA destinations is visible when
          // margins look wrong.
          this.logger.log(
            { shipmentNumber: req.shipmentNumber, pin: req.postalCode },
            'Destination is Out of Delivery Area — slower and surcharged',
          );
        }
        // Their own answer for this PIN, used to fill city/state below.
        return {
          city: check.detail.district ?? '',
          state: check.detail.stateCode ?? '',
        };
      }

      this.logger.warn(
        { shipmentNumber: req.shipmentNumber, pin: req.postalCode, reason: check.reason },
        'Pre-flight serviceability failed — not manifesting a parcel that would be returned',
      );
      // `serviceable: false` is the signal the AWB saga already knows how
      // to handle: supersede the shipment and route the order to manual
      // placement (CUR-7), no retry.
      return {
        blocked: {
          ok: false,
          serviceable: false,
          errorCode: 'DELHIVERY_NOT_SERVICEABLE',
          errorMessage: check.reason ?? 'Destination not serviceable',
        },
      };
    } catch (err) {
      this.logger.warn(
        { shipmentNumber: req.shipmentNumber, err: (err as Error).message },
        'Pre-flight serviceability check failed; falling back to the reactive path',
      );
      // The pre-flight being broken must not stop the shipment; we lose
      // only the resolved locality, and city/state are optional.
      return { city: '', state: '' };
    }
  }

  /**
   * The create payload, with every documented field we can populate.
   *
   * Delhivery's docs ask for all of them even where not mandatory
   * ("good to have for optimal processing"), and several change how the
   * parcel is HANDLED rather than merely describing it: shipping mode and
   * transport speed pick the service, dimensions drive volumetric weight
   * (divisor 5000), fragile/dangerous change handling, and the return
   * block decides where a failed delivery actually goes.
   *
   * ── THE `#` PROBLEM ───────────────────────────────────────────────
   * Delhivery's docs state the raw JSON body rejects `& # % ; \` and
   * that a URL-encoded payload must be used instead. Indian addresses
   * contain `#` constantly ("#402, 3rd Cross"), so this is a live
   * corruption risk rather than an edge case. We are safe by
   * construction — the `form-data-key` encoding in DelhiveryHttpService
   * puts the JSON through URLSearchParams, which percent-encodes all
   * five characters — and `delhivery-awb.service.spec` pins that,
   * because it is exactly the kind of property a future "simplify the
   * encoding" refactor would quietly break.
   */
  /**
   * The per-shipment payload.
   *
   * Shaped to match Delhivery's own documented sample, which carries
   * EVERY optional key — as an empty string when it has no value —
   * rather than omitting them. Our version omitted most of them, and the
   * first live creates came back with an envelope-level "An internal
   * Error has occurred" and, on their staging tier, a raw Python
   * `'NoneType' object has no attribute 'end_date'`. A probe using their
   * sample shape got materially further: package_count 1 and a per-
   * package err_code instead of a crash, with the account and routing
   * resolving fine. Absent keys, not wrong values.
   *
   * `resolved` is Delhivery's OWN answer for this pincode, from the
   * pre-flight serviceability call we already make. ORD-5 stopped asking
   * sellers for city and state because the courier routes on the PIN and
   * knows the locality better than they do — this is where that decision
   * gets paid for, by filling the fields from the source of truth
   * instead of sending blanks.
   */
  private buildShipment(
    req: DelhiveryAwbRequest,
    resolved: { city: string; state: string },
  ): Record<string, unknown> {
    const isCod = req.codAmountInr !== null;
    const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
    return {
      // A pooled waybill when we have one; empty lets Delhivery assign,
      // which works but forfeits pre-allocation.
      waybill: req.waybill ?? '',
      order: req.shipmentNumber,
      name: req.recipientName,
      add: [req.addressLine1, req.addressLine2].filter(Boolean).join(', '),
      pin: req.postalCode,
      city: req.city !== '' ? req.city : resolved.city,
      state: req.stateProvince !== '' ? req.stateProvince : resolved.state,
      country: req.countryCode === 'IN' ? 'India' : req.countryCode,
      // Delhivery wants the NATIONAL number, not E.164. Every sample in
      // their own docs sends "9999999999"; we were sending
      // "+919876543210", and the first real create came back with their
      // generic "An internal Error has occurred" — no named field, which
      // is how a parser choking on an unexpected prefix presents.
      //
      // Only the +91 prefix is stripped, and only when what remains is a
      // plain 10-digit number. A number we cannot confidently reduce is
      // passed through untouched: sending E.164 and being refused is a
      // visible failure, while silently mangling a number produces a
      // parcel that is manifested and undeliverable.
      phone: toNationalPhone(req.recipientPhoneE164),
      payment_mode: isCod ? 'COD' : 'Prepaid',
      cod_amount: isCod ? str(req.codAmountInr) : '',
      total_amount: str(req.declaredValueInr),
      products_desc: req.itemDescription.slice(0, 250),
      quantity: String(req.quantity ?? 1),
      weight: str(req.totalWeightGrams),
      // Present-but-empty, exactly as their sample does it. Their
      // handler reaches for these keys whether or not we have a value.
      hsn_code: '',
      return_pin: '',
      return_city: '',
      return_phone: '',
      return_add: '',
      return_state: '',
      return_country: '',
      seller_add: '',
      seller_name: '',
      seller_inv: '',
      address_type: '',
      order_date: new Date().toISOString().slice(0, 10),
      shipping_mode: req.shippingMode ?? 'Surface',
      ...(req.transportSpeed === undefined ? {} : { transport_speed: req.transportSpeed }),
      ...(req.addressType === undefined ? {} : { address_type: req.addressType }),
      ...(req.lengthCm === undefined ? {} : { shipment_length: req.lengthCm }),
      ...(req.widthCm === undefined ? {} : { shipment_width: req.widthCm }),
      ...(req.heightCm === undefined ? {} : { shipment_height: req.heightCm }),
      ...(req.fragile === undefined ? {} : { fragile_shipment: req.fragile }),
      ...(req.dangerousGood === undefined ? {} : { dangerous_good: req.dangerousGood }),
      ...(req.plasticPackaging === undefined ? {} : { plastic_packaging: req.plasticPackaging }),
      ...(req.sellerName === undefined ? {} : { seller_name: req.sellerName }),
      ...(req.sellerAddress === undefined ? {} : { seller_add: req.sellerAddress }),
      ...(req.sellerInvoiceNumber === undefined ? {} : { seller_inv: req.sellerInvoiceNumber }),
      ...(req.ewaybillNumber === undefined ? {} : { ewbn: req.ewaybillNumber }),
      ...(req.returnName === undefined ? {} : { return_name: req.returnName }),
      ...(req.returnAddress === undefined ? {} : { return_add: req.returnAddress }),
      ...(req.returnCity === undefined ? {} : { return_city: req.returnCity }),
      ...(req.returnState === undefined ? {} : { return_state: req.returnState }),
      ...(req.returnPin === undefined ? {} : { return_pin: req.returnPin }),
      ...(req.returnPhone === undefined ? {} : { return_phone: req.returnPhone }),
      ...(req.returnCountry === undefined ? {} : { return_country: req.returnCountry }),
    };
  }

  /**
   * The warehouse name this parcel is collected from.
   *
   * A pickup location is registered per ACCOUNT and Delhivery matches
   * the name exactly WITHIN that account, so two accounts collecting
   * from the same physical building each need their own registration and
   * may legitimately hold different names. The account's own name wins;
   * the global setting is the single-account fallback and is what
   * production uses today.
   *
   * Falling back when an account HAS no name of its own is deliberate:
   * it keeps a newly-created account working with the existing
   * registration rather than failing every parcel until somebody fills
   * in a field they did not know about.
   */
  private async resolvePickupLocationName(courierAccountId: string | null): Promise<string> {
    if (courierAccountId !== null) {
      const account = await this.prisma.client.courierAccount.findUnique({
        where: { id: courierAccountId },
        select: { pickupLocationName: true },
      });
      const perAccount = (account?.pickupLocationName ?? '').trim();
      if (perAccount) return perAccount;
    }

    const setting = await this.prisma.client.systemSetting.findUnique({
      where: { key: 'courier.delhivery_pickup_location' },
      select: { valueString: true },
    });
    const name = (setting?.valueString ?? '').trim();
    if (!name) {
      throw new Error(
        "Delhivery pickup location not configured: this account has no pickup_location_name and system_settings 'courier.delhivery_pickup_location' is unset. Register the warehouse under this account in Delhivery and record the exact name before enabling real mode.",
      );
    }
    return name;
  }

  private parseCreateResponse(response: DelhiveryCreateResponse): DelhiveryAwbResult {
    const pkg = response.packages?.[0];
    if (response.success === true && pkg && pkg.waybill) {
      return {
        ok: true,
        awbNumber: pkg.waybill,
        courierShipmentId: pkg.refnum ?? pkg.waybill,
        labelUrl: pkg.pdf_download_link ?? null,
      };
    }
    const rmk = (response.rmk ?? '').toString();
    const remarks = (pkg?.remarks ?? []).join(' | ');
    const message = rmk || remarks || 'Delhivery did not return a waybill';
    const isNonServiceable = /serviceab|non-?serviceab|service not avail|pincode.*not.*serv/i.test(
      message,
    );
    return {
      ok: false,
      serviceable: !isNonServiceable,
      errorCode: isNonServiceable ? 'DELHIVERY_NON_SERVICEABLE' : 'DELHIVERY_CREATE_FAILED',
      errorMessage: message,
    };
  }

  private stubGenerateAwb(req: DelhiveryAwbRequest): DelhiveryAwbResult {
    if (req.postalCode === '000000') {
      this.logger.debug(
        { shipmentNumber: req.shipmentNumber },
        'Delhivery STUB: non-serviceable destination',
      );
      return {
        ok: false,
        serviceable: false,
        errorCode: 'STUB_NON_SERVICEABLE',
        errorMessage: 'Stub: destination pincode 000000 is non-serviceable',
      };
    }
    if (req.postalCode === '999999') {
      this.logger.debug(
        { shipmentNumber: req.shipmentNumber },
        'Delhivery STUB: transient courier failure',
      );
      return {
        ok: false,
        serviceable: true,
        errorCode: 'STUB_COURIER_FAILURE',
        errorMessage: 'Stub: transient courier failure for pincode 999999',
      };
    }
    const digits = req.shipmentNumber.replace(/\D/g, '');
    return {
      ok: true,
      awbNumber: `DLVSTUB${digits}`,
      courierShipmentId: `DLVSHP${digits}`,
      labelUrl: null,
    };
  }
}
