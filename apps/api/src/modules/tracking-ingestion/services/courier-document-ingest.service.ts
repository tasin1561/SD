import { Injectable, Logger } from '@nestjs/common';
import { CourierDocumentType, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { EnvService } from '../../../config/env.service';

/** What each courier calls the AWB, the reference and the image. */
interface DocumentFields {
  readonly awbNumber: string | null;
  readonly externalRef: string | null;
  /** Base64 image, or a URL — couriers send both and call both "image". */
  readonly payload: string | null;
}

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Taking a copy of the paperwork a courier pushes us.
 *
 * The point is CUSTODY. Delhivery serves these from URLs that expire,
 * and an EPOD chased six months after a dispute may simply be gone —
 * which is exactly when it is needed, because that is when somebody
 * finally argues about who absorbed the loss. So the bytes are copied
 * into our own bucket at the moment they exist.
 *
 * Nothing here throws at the caller. A courier webhook that 500s gets
 * retried, and a retry storm because our Spaces credentials expired is a
 * worse outcome than a missing image: the raw payload is already
 * recorded in `courier_webhooks` either way, so a failed store can be
 * replayed from the ledger rather than lost.
 */
@Injectable()
export class CourierDocumentIngestService {
  private readonly logger = new Logger(CourierDocumentIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
    private readonly env: EnvService,
  ) {}

  /**
   * Field names differ per document and are theirs, not ours — `waybill`
   * on an EPOD, `Waybill` on a sorter image, `waybillId` on a QC photo,
   * and the casing is inconsistent in their own documentation. Read
   * case-insensitively across the known aliases rather than trusting one
   * spelling: the cost of guessing wrong is a document we accept and
   * then cannot attach to anything.
   */
  private read(body: Record<string, unknown>, keys: readonly string[]): string | null {
    const lower = new Map(Object.entries(body).map(([k, v]) => [k.toLowerCase(), v]));
    for (const k of keys) {
      const v = lower.get(k.toLowerCase());
      if (typeof v === 'string' && v.trim() !== '') return v.trim();
    }
    return null;
  }

  extract(docType: CourierDocumentType, body: Record<string, unknown>): DocumentFields {
    const awbNumber = this.read(body, ['waybill', 'waybillId', 'awb', 'awbNumber']);
    const externalRef = this.read(body, ['orderID', 'orderId', 'returnId', 'doc', 'reference']);
    const payload =
      docType === CourierDocumentType.EPOD
        ? this.read(body, ['EPOD', 'epod', 'image'])
        : docType === CourierDocumentType.SORTER_IMAGE
          ? this.read(body, ['Weight_images', 'weightImages', 'image'])
          : this.read(body, ['Image', 'image', 'qcImage']);
    return { awbNumber, externalRef, payload };
  }

  /**
   * Store what arrived. Best-effort by design (see the class note).
   *
   * The row is written even when the bytes cannot be — with the reason —
   * because "they sent us an EPOD and we failed to keep it" and "they
   * never sent one" are different facts, and only one of them is
   * somebody's job to fix.
   */
  async ingest(input: {
    courierCode: string;
    docType: CourierDocumentType;
    body: Record<string, unknown>;
    webhookId: string | null;
  }): Promise<{ stored: boolean; awbNumber: string | null }> {
    const fields = this.extract(input.docType, input.body);
    if (fields.awbNumber === null) {
      this.logger.warn(
        { courierCode: input.courierCode, docType: input.docType },
        'Courier document arrived with no AWB — kept in the raw ledger only',
      );
      return { stored: false, awbNumber: null };
    }

    // Matched where we can, kept where we cannot. An orphan document is
    // still evidence we were sent something.
    // Both database calls below are guarded. The class promises never to
    // throw at the courier and, until this, did not keep that promise:
    // the Spaces upload was wrapped and the queries were not, so a
    // transient database error became a 500 and a retry storm — the very
    // outcome the design was chosen to avoid.
    let shipment: { id: string } | null = null;
    try {
      shipment = await this.prisma.client.shipment.findFirst({
        where: { awbNumber: fields.awbNumber, deletedAt: null },
        select: { id: true },
      });
    } catch (e) {
      // Not fatal: an unmatched document is still kept (see below), so a
      // lookup failure costs the link, not the evidence.
      this.logger.warn(
        { awbNumber: fields.awbNumber, error: (e as Error).message },
        'Could not look up the shipment for a courier document',
      );
    }

    let spacesKey: string | null = null;
    let mimeType: string | null = null;
    let size: number | null = null;
    let storeError: string | null = null;

    if (fields.payload === null) {
      storeError = 'No image field in the payload';
    } else {
      try {
        const decoded = this.decode(fields.payload);
        if (decoded === null) {
          // A URL rather than bytes. Recorded as-is instead of fetched:
          // fetching a courier-supplied URL from inside a webhook is an
          // outbound request to whatever they name, which is the SSRF
          // shape the outbound-webhook guard exists for.
          storeError = `Payload was a reference, not image bytes: ${fields.payload.slice(0, 200)}`;
        } else if (decoded.bytes.byteLength > MAX_BYTES) {
          storeError = `Image is ${decoded.bytes.byteLength} bytes, over the ${MAX_BYTES} limit`;
        } else {
          const key = `courier-documents/${input.courierCode}/${input.docType.toLowerCase()}/${fields.awbNumber}.${decoded.ext}`;
          await this.spaces.putObject(key, decoded.bytes, decoded.mime);
          spacesKey = key;
          mimeType = decoded.mime;
          size = decoded.bytes.byteLength;
        }
      } catch (e) {
        storeError = (e as Error).message;
      }
    }

    const data = {
      shipmentId: shipment?.id ?? null,
      externalRef: fields.externalRef,
      spacesKey,
      spacesBucket: spacesKey === null ? null : this.env.spacesBucket,
      mimeType,
      fileSizeBytes: size,
      storeError,
      webhookId: input.webhookId,
      receivedAt: new Date(),
    } satisfies Prisma.CourierDocumentUncheckedUpdateInput;

    // Upsert on the natural key: a courier re-sending the same EPOD must
    // update the row it already has rather than leaving two.
    try {
      await this.prisma.client.courierDocument.upsert({
        where: {
          courierCode_awbNumber_docType: {
            courierCode: input.courierCode,
            awbNumber: fields.awbNumber,
            docType: input.docType,
          },
        },
        create: {
          courierCode: input.courierCode,
          awbNumber: fields.awbNumber,
          docType: input.docType,
          ...data,
        },
        update: data,
      });
    } catch (e) {
      // The bytes may already be in Spaces; the raw payload is in
      // courier_webhooks either way, so this replays from the ledger.
      this.logger.error(
        { awbNumber: fields.awbNumber, docType: input.docType, error: (e as Error).message },
        'Could not record a courier document — the raw webhook row is the fallback',
      );
      return { stored: false, awbNumber: fields.awbNumber };
    }

    if (storeError !== null) {
      this.logger.warn(
        { awbNumber: fields.awbNumber, docType: input.docType, storeError },
        'Courier document recorded but the file was not stored',
      );
    }
    return { stored: spacesKey !== null, awbNumber: fields.awbNumber };
  }

  /**
   * Base64 — with or without a data: prefix — into bytes.
   *
   * Returns null for anything that is not image bytes, which includes a
   * URL. Their documentation calls the sorter field "base64 URL", and
   * whichever of the two it turns out to be, guessing produces a
   * corrupt file rather than an error.
   */
  private decode(raw: string): { bytes: Buffer; mime: string; ext: string } | null {
    const dataUri = /^data:([\w/+.-]+);base64,(.*)$/s.exec(raw);
    const b64 = dataUri === null ? raw : (dataUri[2] ?? '');
    if (/^https?:\/\//i.test(raw)) return null;
    if (!/^[A-Za-z0-9+/=\s]+$/.test(b64) || b64.trim().length < 32) return null;

    const bytes = Buffer.from(b64, 'base64');
    if (bytes.byteLength === 0) return null;

    // Sniffed from the bytes, not from what they claimed: a wrong
    // extension makes a stored file unopenable later.
    const mime =
      dataUri?.[1] ??
      (bytes[0] === 0xff && bytes[1] === 0xd8
        ? 'image/jpeg'
        : bytes[0] === 0x89 && bytes[1] === 0x50
          ? 'image/png'
          : bytes.subarray(0, 4).toString('ascii') === '%PDF'
            ? 'application/pdf'
            : 'application/octet-stream');
    const ext =
      mime === 'image/jpeg'
        ? 'jpg'
        : mime === 'image/png'
          ? 'png'
          : mime === 'application/pdf'
            ? 'pdf'
            : 'bin';
    return { bytes, mime, ext };
  }
}
