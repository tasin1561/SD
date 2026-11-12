import { Injectable } from '@nestjs/common';
import { assertPublicHttpsUrl } from '../../../common/net/ssrf-guard';
import { DelhiveryHttpService } from './delhivery-http.service';
import type { DelhiveryClient, DelhiveryLabelResult } from '../types/delhivery.types';
import type { CourierCredentialActor } from '../../courier-shared/services/courier-credential.service';

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

  /**
   * THIS parcel's routing code, from the packing-slip metadata.
   *
   * The most authoritative source we have: the booking response is the
   * same fact at the same moment, but a pincode lookup is only generic
   * for the destination — if the two ever disagree, the code on the
   * parcel's own slip is the one its hub will sort by (owner,
   * 2026-11-12).
   *
   * Reads the JSON we ALREADY fetch to find the PDF link, not the PDF
   * itself. Their label is drawn with subset fonts whose text is glyph
   * ids rather than characters, so scraping it would be the most
   * fragile link in the dispatch path and would break silently the day
   * they change a font.
   *
   * Delhivery's key for it has varied across their docs, so several
   * spellings are accepted and anything unrecognisable is ignored.
   * Returns null rather than throwing: a label still prints without it,
   * carrying its own visible warning.
   */
  async fetchSortCode(awbNumber: string, actor?: CourierCredentialActor): Promise<string | null> {
    if (await this.http.isStubMode()) return null;
    try {
      const meta = await this.http.request<{ packages?: Array<Record<string, unknown>> }>({
        actor,
        method: 'GET',
        path: `/api/p/packing_slip?wbns=${encodeURIComponent(awbNumber)}`,
        endpoint: 'label',
      });
      const pkg = meta.packages?.[0];
      if (pkg === undefined) return null;
      for (const [key, value] of Object.entries(pkg)) {
        if (!/^sort[_ ]?code$|^sortcode$/i.test(key)) continue;
        const code = typeof value === 'string' ? value.trim() : '';
        if (code !== '') return code;
      }
      return null;
    } catch {
      return null;
    }
  }

  async fetchLabel(
    awbNumber: string,
    actor?: CourierCredentialActor,
  ): Promise<DelhiveryLabelResult> {
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
      actor,
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
    //
    // It is a URL from a RESPONSE, so it goes through the same guard a
    // seller-supplied webhook URL does: the bytes are stored in our Spaces
    // and later presigned for a seller to open, so a link answering with
    // the droplet's metadata service would be laundered into a document.
    // `redirect: 'error'` is the other half — the guard resolves the host
    // it was given, and a redirect is how you get somewhere it never
    // checked.
    const safe = await assertPublicHttpsUrl(link);
    const res = await fetch(safe, {
      method: 'GET',
      redirect: 'error',
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
