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
/** 4in x 6in at 72pt/in — the label stock the warehouse prints on. */
const LABEL_W = 288;
const LABEL_H = 432;

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
        /*
          EVERY PAGE COMES OUT 4x6 (2026-09-09).

          The sources disagree about paper: Delhivery hands back what
          their account is configured for, Shiprocket another size, and
          ours is drawn at 4x6. Copied through unchanged, one stack
          contained pages of three sizes — which a label printer either
          refuses or silently scales per page, and a barcode scaled by an
          amount nobody chose is one that may not read.

          So each source page is EMBEDDED and drawn onto a 4x6 page,
          scaled to fit and centred. Aspect ratio is preserved: stretching
          a label distorts its barcode, and the bars are the part that has
          to survive.
        */
        for (const index of src.getPageIndices()) {
          const embedded = await out.embedPage(src.getPage(index));
          const page = out.addPage([LABEL_W, LABEL_H]);
          const scale = Math.min(
            LABEL_W / embedded.width,
            LABEL_H / embedded.height,
            // Never scale UP past 1: a small label blown up to fill the
            // page prints a fuzzy barcode where the original was sharp.
            1,
          );
          page.drawPage(embedded, {
            xScale: scale,
            yScale: scale,
            x: (LABEL_W - embedded.width * scale) / 2,
            y: (LABEL_H - embedded.height * scale) / 2,
          });
        }
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
