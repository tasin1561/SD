import { Injectable, Logger } from '@nestjs/common';
import { DelhiveryHttpService } from './delhivery-http.service';

/** Document types Delhivery will return for a B2C consignment. */
export type DelhiveryDocumentType =
  /** The consignee's signature image. */
  | 'SIGNATURE_URL'
  /** Photos taken during a reverse-pickup quality check. */
  | 'RVP_QC_IMAGE'
  /** Electronic proof of delivery. */
  | 'EPOD'
  /** Image captured when a seller return is processed. */
  | 'SELLER_RETURN_IMAGE';

export interface DelhiveryDocumentResult {
  readonly awbNumber: string;
  readonly docType: DelhiveryDocumentType;
  /** URL Delhivery serves the document from, when one exists. */
  readonly url: string | null;
  readonly message: string | null;
  readonly raw: unknown;
}

/**
 * Fetching the paperwork behind a delivery.
 *
 * This is the evidence layer. When a customer says "I never received it"
 * and the courier says it was delivered, the EPOD and the signature are
 * what settle it — and settling it decides who absorbs the loss, the
 * seller or Skydrop. Without them a dispute is one party's word against
 * another's, which in practice means whoever shouts loudest wins.
 *
 * Read-only and free, so it is safe to call against production and needs
 * no write guard. Delhivery notes these are only available for documents
 * "not archived" in their system, so fetching promptly after delivery
 * matters — an EPOD chased six months later may simply be gone. That is
 * an argument for pulling and storing them on our side rather than
 * linking out to Delhivery, which is the natural follow-up once a
 * dispute workflow exists.
 */
@Injectable()
export class DelhiveryDocumentService {
  private readonly logger = new Logger(DelhiveryDocumentService.name);

  constructor(private readonly http: DelhiveryHttpService) {}

  async fetch(awbNumber: string, docType: DelhiveryDocumentType): Promise<DelhiveryDocumentResult> {
    if (await this.http.isStubMode()) {
      return {
        awbNumber,
        docType,
        url: `https://stub.local/${docType.toLowerCase()}/${awbNumber}.pdf`,
        message: 'stub',
        raw: null,
      };
    }

    const raw = await this.http.request<Record<string, unknown>>({
      method: 'GET',
      path:
        `/api/rest/fetch/pkg/document/?doc_type=${encodeURIComponent(docType)}` +
        `&waybill=${encodeURIComponent(awbNumber)}`,
      endpoint: 'document',
    });

    // Delhivery is inconsistent about where the URL lands, so check the
    // plausible keys rather than assuming one.
    const url =
      (raw['url'] as string | undefined) ??
      (raw['document_url'] as string | undefined) ??
      (raw['data'] as string | undefined) ??
      null;
    const message =
      (raw['error'] as string | undefined) ?? (raw['rmk'] as string | undefined) ?? null;

    if (url === null) {
      this.logger.warn(
        { awbNumber, docType, message },
        'No document URL returned — it may not exist yet, or may have been archived',
      );
    }
    return { awbNumber, docType, url, message, raw };
  }
}
