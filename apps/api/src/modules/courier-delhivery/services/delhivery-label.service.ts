import { Injectable } from '@nestjs/common';
import { DelhiveryHttpService } from './delhivery-http.service';
import type {
  DelhiveryClient,
  DelhiveryLabelResult,
} from '../types/delhivery.types';

/**
 * Module 9 — Delhivery shipping-label fetch (commit 6). Implements the
 * `fetchLabel` slice of the DelhiveryClient adapter.
 *
 * STUB MODE: returns deterministic mock PDF bytes (a minimal valid PDF
 * header) — AwbGenerationService uploads them to OUR Spaces and records
 * the key in `awb_labels` (CUR-6). The bytes' content is not inspected
 * downstream; only the persist-to-Spaces path is exercised.
 *
 * REAL MODE: TODO(delhivery-api) — fetch the label PDF from Delhivery's
 * label endpoint. DelhiveryHttpService.request throws until the wire
 * contract is validated.
 */
@Injectable()
export class DelhiveryLabelService implements Pick<DelhiveryClient, 'fetchLabel'> {
  constructor(private readonly http: DelhiveryHttpService) {}

  async fetchLabel(awbNumber: string): Promise<DelhiveryLabelResult> {
    if (await this.http.isStubMode()) {
      // Minimal deterministic PDF stub — keyed on the AWB so distinct
      // shipments produce distinct bytes.
      const bytes = Buffer.from(
        `%PDF-1.4\n% Skydrop stub label for AWB ${awbNumber}\n%%EOF\n`,
        'utf8',
      );
      return { bytes, mimeType: 'application/pdf' };
    }

    // ── REAL MODE — TODO(delhivery-api) ──────────────────────────────
    // GET the label PDF for `awbNumber`.
    //   - TODO(delhivery-api): label endpoint path + query params
    //   - TODO(delhivery-api): whether the response is the raw PDF or a
    //     URL to follow; map to DelhiveryLabelResult.bytes
    await this.http.authHeaders();
    return this.http.request<DelhiveryLabelResult>({
      method: 'GET',
      path: `/TODO(delhivery-api):label/${awbNumber}`,
    });
  }
}
