import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { DelhiveryHttpService } from './delhivery-http.service';
import { DelhiveryWriteGuardService } from './delhivery-write-guard.service';
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

@Injectable()
export class DelhiveryAwbService implements Pick<DelhiveryClient, 'generateAwb'> {
  private readonly logger = new Logger(DelhiveryAwbService.name);

  constructor(
    private readonly http: DelhiveryHttpService,
    private readonly prisma: PrismaService,
    private readonly writeGuard: DelhiveryWriteGuardService,
  ) {}

  async generateAwb(req: DelhiveryAwbRequest): Promise<DelhiveryAwbResult> {
    if (await this.http.isStubMode()) {
      return this.stubGenerateAwb(req);
    }

    const pickupLocationName = await this.resolvePickupLocationName();
    const envelope = {
      shipments: [
        {
          waybill: '', // empty → Delhivery assigns
          order: req.shipmentNumber,
          name: req.recipientName,
          add: [req.addressLine1, req.addressLine2].filter(Boolean).join(', '),
          pin: req.postalCode,
          city: req.city,
          state: req.stateProvince,
          country: req.countryCode === 'IN' ? 'India' : req.countryCode,
          phone: req.recipientPhoneE164,
          payment_mode: req.codAmountInr !== null ? 'COD' : 'Prepaid',
          cod_amount: req.codAmountInr ?? '0',
          total_amount: req.declaredValueInr,
          products_desc: req.itemDescription.slice(0, 250),
          quantity: 1,
          weight: String(req.totalWeightGrams),
          order_date: new Date().toISOString().slice(0, 10),
        },
      ],
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

  private async resolvePickupLocationName(): Promise<string> {
    const setting = await this.prisma.client.systemSetting.findUnique({
      where: { key: 'courier.delhivery_pickup_location' },
      select: { valueString: true },
    });
    const name = (setting?.valueString ?? '').trim();
    if (!name) {
      throw new Error(
        "Delhivery pickup location not configured (system_settings 'courier.delhivery_pickup_location'). Register the warehouse name in Delhivery's portal and set this key before enabling real mode.",
      );
    }
    return name;
  }

  private parseCreateResponse(
    response: DelhiveryCreateResponse,
  ): DelhiveryAwbResult {
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
    const isNonServiceable =
      /serviceab|non-?serviceab|service not avail|pincode.*not.*serv/i.test(message);
    return {
      ok: false,
      serviceable: !isNonServiceable,
      errorCode: isNonServiceable
        ? 'DELHIVERY_NON_SERVICEABLE'
        : 'DELHIVERY_CREATE_FAILED',
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
