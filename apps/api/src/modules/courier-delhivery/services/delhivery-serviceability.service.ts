import { Injectable } from '@nestjs/common';
import { DelhiveryHttpService } from './delhivery-http.service';
import type {
  DelhiveryClient,
  DelhiveryServiceabilityResult,
} from '../types/delhivery.types';

/**
 * Module 9 — Delhivery pincode serviceability (commit 6). Implements
 * the `checkServiceability` slice of the DelhiveryClient adapter.
 *
 * CUR-5: serviceability is REACTIVE — the AUTHORITATIVE answer is the
 * AWB-generation response (DelhiveryAwbResult.serviceable). This
 * service is an OPTIONAL advisory pre-check, NOT wired into the AWB
 * saga (proactive/cached serviceability is a Phase-2 deferral —
 * phase-1a-debt). `fromLiveApi:false` marks a stub answer as a
 * non-authoritative assumption.
 *
 * STUB MODE: '000000' → not serviceable (consistent with
 * DelhiveryAwbService's stub convention); any other pincode →
 * serviceable. `fromLiveApi:false` always in stub mode.
 *
 * REAL MODE: TODO(delhivery-api) — the pincode-serviceability endpoint.
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

    // ── REAL MODE — TODO(delhivery-api) ──────────────────────────────
    //   - TODO(delhivery-api): serviceability endpoint path + the
    //     pin-code query param name
    //   - TODO(delhivery-api): parse the response → serviceable boolean
    await this.http.authHeaders();
    const result = await this.http.request<{ serviceable: boolean }>({
      method: 'GET',
      path: `/TODO(delhivery-api):serviceability/${pincode}`,
    });
    return { serviceable: result.serviceable, fromLiveApi: true };
  }
}
