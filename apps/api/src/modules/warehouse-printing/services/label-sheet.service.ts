import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';

/**
 * One file out of many labels.
 *
 * Delhivery hands back a PDF, Shiprocket a URL we download to a PDF, and
 * a manual parcel has no label at all so we draw one. Three sources, and
 * whoever is standing at the printer wants ONE thing to press print on.
 *
 * Merging is done here rather than at each call site so the ORDER of the
 * sheet is a single decision: labels come out in the order the operator
 * selected them, which is the order they will be sorted into on the
 * bench. A file whose pages are grouped by courier makes somebody sort
 * the pile twice.
 *
 * A label that could not be fetched is REPORTED, never silently dropped.
 * A short stack is indistinguishable from a complete one once it is on
 * the bench, and the parcel with no label is the one that ships to
 * nobody.
 */
@Injectable()
export class LabelSheetService {
  private readonly logger = new Logger(LabelSheetService.name);

  async merge(
    parts: ReadonlyArray<{ shipmentId: string; bytes: Buffer }>,
  ): Promise<{ pdf: Buffer; pageCount: number; failed: string[] }> {
    const out = await PDFDocument.create();
    out.setTitle('Shipping labels');
    out.setProducer('Skydrop');

    const failed: string[] = [];
    for (const part of parts) {
      try {
        const src = await PDFDocument.load(part.bytes, { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        for (const page of pages) out.addPage(page);
      } catch (err) {
        // A courier PDF we cannot parse is the one case worth being
        // loud about: the parcel is real, its label is not in the stack,
        // and nothing downstream would notice.
        this.logger.warn(
          { shipmentId: part.shipmentId, err: (err as Error).message },
          'Could not merge a label into the sheet',
        );
        failed.push(part.shipmentId);
      }
    }

    const bytes = await out.save();
    return { pdf: Buffer.from(bytes), pageCount: out.getPageCount(), failed };
  }
}
