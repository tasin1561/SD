import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

/** One place that writes the CSV response, so every console sends the same headers. */
export function sendCsv(
  res: Response,
  out: { csv: string; fileName: string; rowCount: number; missingCount: number },
): void {
  res
    .status(HttpStatus.OK)
    .set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${out.fileName}"`,
      'Cache-Control': 'no-store',
      'X-Bulk-Exported': String(out.rowCount),
      'X-Bulk-Skipped': String(out.missingCount),
      'Access-Control-Expose-Headers': 'Content-Disposition, X-Bulk-Exported, X-Bulk-Skipped',
    })
    .send(out.csv);
}
