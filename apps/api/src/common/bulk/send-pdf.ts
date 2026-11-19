import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

/** One place that writes a merged-PDF response for every bulk download. */
export function sendPdf(
  res: Response,
  out: { pdf: Buffer; fileName: string; included: number; skipped: number },
): void {
  res
    .status(HttpStatus.OK)
    .set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${out.fileName}"`,
      'Cache-Control': 'no-store',
      'X-Bulk-Included': String(out.included),
      'X-Bulk-Skipped': String(out.skipped),
      'Access-Control-Expose-Headers': 'Content-Disposition, X-Bulk-Included, X-Bulk-Skipped',
    })
    .send(out.pdf);
}
