'use client';

import type { ReactElement } from 'react';
import { Barcode128, Button } from '@skydrop/ui/components';
import type { SkuLabelSheet } from '@/lib/api-hooks';
import { useT } from '@/i18n/client';

/**
 * Product stickers — one per physical unit, both inventory modes.
 *
 * A NORMAL-mode product has no per-unit identity, so every sticker for
 * a SKU is identical; a STRICT one additionally carries its own serial
 * from the consignment sheet. Either way there is now something on the
 * item for the packing bench to scan, which there was not before: the
 * contents check resolved a scan against `product_variants.barcode`,
 * nothing printed one, and no seller in production had filled it in.
 *
 * The same repeat-per-quantity trick as any label run: the sheet is
 * flattened to one <div> per sticker so the browser's own pagination
 * handles the page breaks, rather than us guessing a rows-per-page.
 */
export function SkuLabelSheetView({
  sheet,
  onClose,
}: {
  readonly sheet: SkuLabelSheet;
  readonly onClose: () => void;
}): ReactElement {
  const t = useT();
  const stickers = sheet.labels.flatMap((l) =>
    Array.from({ length: l.quantity }, (_, i) => ({ ...l, key: `${l.variantId}-${i}` })),
  );

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

      <div className="sd-label-sheet__chrome mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{sheet.title}</h2>
          <p className="text-text-muted mt-0.5 text-xs">
            {t('skuLabelSheet.stickerOnePerUnitStick', {
              totalStickers: sheet.totalStickers,
              value: sheet.totalStickers === 1 ? '' : t('common.pluralS'),
            })}
          </p>
          {sheet.labels.some((l) => l.usedSkuCode) && (
            <p className="text-text-faint mt-1 text-xs">{t('skuLabelSheet.someOfTheseCarryThe')}</p>
          )}
          {sheet.skippedStrict.length > 0 && (
            <p className="text-text-muted mt-1 text-xs">
              {t('skuLabelSheet.notOnThisSheetStrict', { value: sheet.skippedStrict.join(', ') })}
            </p>
          )}
          {sheet.labels.some((l) => l.barcodeWidths === null) && (
            <p className="text-status-failed-fg mt-1 text-xs">
              {t('skuLabelSheet.oneOrMoreCodesCannot')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => window.print()}>{t('skuLabelSheet.sendToPrinter')}</Button>
          <Button variant="secondary" onClick={onClose}>
            {t('skuLabelSheet.done')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {stickers.map((l) => (
          <div
            key={l.key}
            className="sd-label-sheet__label border-border-strong rounded-[4px] border p-2"
          >
            {l.barcodeWidths !== null && (
              <Barcode128
                widths={l.barcodeWidths}
                label={l.value}
                heightMm={10}
                className="mb-1 block"
              />
            )}
            <p className="font-mono text-[12px] leading-tight font-medium tracking-tight">
              {l.value}
            </p>
            <p className="mt-0.5 text-[11px] leading-tight">
              {l.productName}
              {l.variantLabel === null ? '' : ` — ${l.variantLabel}`}
            </p>
            {!l.usedSkuCode && (
              <p className="mt-0.5 font-mono text-[10px] leading-tight">{l.skuCode}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
