import { Injectable } from '@nestjs/common';
import { DelhiveryHttpService } from './delhivery-http.service';
import type { DelhiveryClient, DelhiveryLabelResult } from '../types/delhivery.types';

/**
 * Module 9 — Delhivery shipping-label fetch. Implements the
 * `fetchLabel` slice of the DelhiveryClient adapter.
 *
 * STUB MODE: returns deterministic mock PDF bytes — AwbGenerationService
 * uploads them to OUR Spaces and records the key in `awb_labels` (CUR-6).
 *
 * REAL MODE: per https://track.delhivery.com/api/ — the packing-slip
 * endpoint returns JSON whose `packages[].pdf_download_link` is a
 * pre-signed URL we then fetch the raw PDF from.
 *
 *   GET /api/p/packing_slip?wbns=<AWB>&pdf=true
 *
 * Two-step: (1) JSON call to get the URL; (2) GET that URL → PDF bytes.
 * If Delhivery decides to return the PDF inline some day, the second
 * fetch returns bytes directly and we use those.
 */
@Injectable()
export class DelhiveryLabelService implements Pick<DelhiveryClient, 'fetchLabel'> {
  constructor(private readonly http: DelhiveryHttpService) {}

  async fetchLabel(awbNumber: string): Promise<DelhiveryLabelResult> {
    if (await this.http.isStubMode()) {
      const bytes = Buffer.from(
        `%PDF-1.4\n% Skydrop stub label for AWB ${awbNumber}\n%%EOF\n`,
        'utf8',
      );
      return { bytes, mimeType: 'application/pdf' };
    }

    const meta = await this.http.request<{
      packages?: Array<{ waybill?: string; pdf_download_link?: string }>;
    }>({
      method: 'GET',
      path: `/api/p/packing_slip?wbns=${encodeURIComponent(awbNumber)}&pdf=true&pdf_size=4R`,
      endpoint: 'label',
    });

    const link = meta.packages?.[0]?.pdf_download_link;
    if (!link) {
      throw new Error(`Delhivery did not return a pdf_download_link for AWB ${awbNumber}`);
    }

    // The pre-signed URL is fetched directly (no auth header — the URL
    // carries its own signature). 30s timeout for the binary.
    const res = await fetch(link, {
      method: 'GET',
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`Delhivery label download for ${awbNumber} → HTTP ${res.status}`);
    }
    const arrayBuf = await res.arrayBuffer();
    const mime = res.headers.get('content-type') ?? 'application/pdf';
    return { bytes: Buffer.from(arrayBuf), mimeType: mime };
  }
}
