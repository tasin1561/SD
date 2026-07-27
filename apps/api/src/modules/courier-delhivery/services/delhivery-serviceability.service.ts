import { Injectable } from '@nestjs/common';
import { DelhiveryHttpService } from './delhivery-http.service';
import type {
  DelhiveryClient,
  DelhiveryServiceabilityResult,
} from '../types/delhivery.types';

/**
 * Module 9 — Delhivery pincode serviceability. Implements the
 * `checkServiceability` slice of the DelhiveryClient adapter.
 *
 * CUR-5: serviceability is REACTIVE — the AUTHORITATIVE answer is the
 * AWB-generation response. This service is an OPTIONAL advisory
 * pre-check.
 *
 * REAL MODE: per https://track.delhivery.com/api/ — the pincode lookup
 *
 *   GET /c/api/pin-codes/json/?filter_codes=<pincode>
 *
 * Response shape:
 *   { delivery_codes: [{ postal_code: { pin, city, ..., covid_zone, ... } }] }
 * A non-empty `delivery_codes` array → Delhivery serves this pin.
 */
@Injectable()
export class DelhiveryServiceabilityService
  implements Pick<DelhiveryClient, 'checkServiceability'>
{
  constructor(private readonly http: DelhiveryHttpService) {}

  async checkServiceability(
    pincode: string,
  ): Promise<DelhiveryServiceabilityResult> {
    if (await this.http.isStubMode()) {
      return {
        serviceable: pincode !== '000000',
        fromLiveApi: false,
      };
    }

    const result = await this.http.request<{
      delivery_codes?: Array<{ postal_code?: { pin?: number | string } }>;
    }>({
      method: 'GET',
      path: `/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pincode)}`,
      endpoint: 'serviceability',
    });
    const serviceable = (result.delivery_codes ?? []).length > 0;
    return { serviceable, fromLiveApi: true };
  }
}
