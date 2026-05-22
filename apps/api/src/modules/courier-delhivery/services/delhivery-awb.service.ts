import { Injectable, Logger } from '@nestjs/common';
import { DelhiveryHttpService } from './delhivery-http.service';
import type {
  DelhiveryAwbRequest,
  DelhiveryAwbResult,
  DelhiveryClient,
} from '../types/delhivery.types';

/**
 * Module 9 — Delhivery AWB generation (commit 5). Implements the
 * `generateAwb` slice of the `DelhiveryClient` adapter interface.
 *
 * ── STUB MODE (default) ────────────────────────────────────────────
 * When DelhiveryHttpService reports stub mode (empty
 * `courier.delhivery_api_base_url`), `generateAwb` returns a
 * DETERMINISTIC mock result with NO network call. The result is keyed
 * on the destination postal code so e2e can drive every branch:
 *
 *   - postalCode '000000' → non-serviceable failure (ok:false,
 *       serviceable:false) — drives CUR-5 auto-supersede → manual
 *       placement.
 *   - postalCode '999999' → transient courier failure (ok:false,
 *       serviceable:true) — drives CUR-2 retry / per-shipment isolation.
 *   - any other postalCode → success: awbNumber `DLVSTUB<digits>`
 *       (deterministic + unique — derived from the unique shipmentNumber),
 *       courierShipmentId, labelUrl null (label fetched separately,
 *       CUR-6).
 *
 * ── REAL MODE ──────────────────────────────────────────────────────
 * When a base URL is configured, generateAwb marshals the request and
 * calls DelhiveryHttpService.request — which throws until the
 * Delhivery wire contract is validated (TODO(delhivery-api)). The
 * entire AWB-generation saga above this adapter is built + tested in
 * stub mode.
 */
@Injectable()
export class DelhiveryAwbService implements Pick<DelhiveryClient, 'generateAwb'> {
  private readonly logger = new Logger(DelhiveryAwbService.name);

  constructor(private readonly http: DelhiveryHttpService) {}

  async generateAwb(req: DelhiveryAwbRequest): Promise<DelhiveryAwbResult> {
    if (await this.http.isStubMode()) {
      return this.stubGenerateAwb(req);
    }

    // ── REAL MODE — TODO(delhivery-api) ──────────────────────────────
    // Marshal `req` into Delhivery's create-shipment payload and POST it.
    //   - TODO(delhivery-api): endpoint path (e.g. /api/cmu/create.json?)
    //   - TODO(delhivery-api): request envelope + field names
    //   - TODO(delhivery-api): parse the response → awbNumber +
    //     courierShipmentId; map a non-serviceable rejection to
    //     {ok:false, serviceable:false} and any other failure to
    //     {ok:false, serviceable:true}
    // DelhiveryHttpService.request currently throws — real mode is not
    // operable until the contract is validated.
    await this.http.authHeaders();
    return this.http.request<DelhiveryAwbResult>({
      method: 'POST',
      path: '/TODO(delhivery-api):create-shipment',
      body: req,
    });
  }

  /** Deterministic stub — see class JSDoc for the postal-code branches. */
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
