'use client';

import type { ReactElement } from 'react';
import { Button } from '@skydrop/ui/components';
import type { LabelSheet } from '@skydrop/api-client';

/**
 * The printable label sheet.
 *
 * The serial is rendered as a MONOSPACE STRING, not a barcode symbology.
 * That is a deliberate stopping point rather than an oversight: a
 * scannable barcode needs a rendering library, and the scanner at the
 * bench accepts typed input, so a legible string is usable on day one and
 * a symbology can be added later without changing anything else here.
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
