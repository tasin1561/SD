'use client';

import type { ReactElement } from 'react';
import { Barcode128, Button } from '@skydrop/ui/components';
import type { LabelSheet } from '@skydrop/api-client';

/**
 * The printable label sheet.
 *
 * The serial prints as a SCANNABLE Code 128 symbol with the string
 * underneath it (2026-09-04). It was a monospace string alone until
 * then — a deliberate stopping point at the time, on the grounds that
 * the bench scanner accepts typed input — but that made STRICT mode a
 * typing exercise: ten characters read off a carton and keyed in at
 * every gate, which is both slow and the one place a transcription
 * error puts the wrong unit on an order.
 *
 * The ENCODING is done on the server and arrives as module widths; this
 * only draws. A second encoder here would not fail loudly if it
 * disagreed — it would print a barcode that scans as a different value
 * than the text beside it.
 *
 * `@media print` hides the whole app and prints only the grid — a label
 * sheet with a sidebar and a page header on it wastes a sheet of labels
 * every time.
 */
export function LabelSheetView({
  sheet,
  onClose,
}: {
  readonly sheet: LabelSheet;
  readonly onClose: () => void;
}): ReactElement {
  return (
    <div className="sd-label-sheet">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .sd-label-sheet, .sd-label-sheet * { visibility: visible !important; }
          .sd-label-sheet {
            position: absolute !important;
            inset: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            color: #000 !important;
          }
          .sd-label-sheet__chrome { display: none !important; }
          .sd-label-sheet__label {
            border-color: #000 !important;
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>

      <div className="sd-label-sheet__chrome border-border-subtle mb-3 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <div>
          <h3 className="text-text-bright text-sm font-medium">
            {sheet.labels.length} label(s) — {sheet.consignmentNumber}
          </h3>
          <p className="text-text-muted text-sm">
            Printed in {sheet.site === 'BD' ? 'Bangladesh' : 'India'}. The station is now locked for
            this consignment.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => window.print()}>Send to printer</Button>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {sheet.labels.map((l) => (
          <div
            key={l.serialBarcode}
            className="sd-label-sheet__label border-border-strong rounded-[4px] border p-2"
          >
            {l.barcodeWidths !== null && (
              <Barcode128
                widths={l.barcodeWidths}
                label={l.serialBarcode}
                heightMm={10}
                className="mb-1 block"
              />
            )}
            <p className="font-mono text-[13px] leading-tight font-medium tracking-tight">
              {l.serialBarcode}
            </p>
            <p className="mt-1 font-mono text-[11px] leading-tight">{l.skuCode}</p>
            <p className="mt-0.5 text-[11px] leading-tight">
              {l.productName}
              {l.variantLabel === null ? '' : ` — ${l.variantLabel}`}
            </p>
            {l.expiresAt !== null && (
              <p className="mt-0.5 text-[11px] leading-tight tabular-nums">
                exp {new Date(l.expiresAt).toISOString().slice(0, 10)}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
