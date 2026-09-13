'use client';

import { useState, type ReactElement } from 'react';
import { Button, FormField, Input, ProductThumb, Select } from '@skydrop/ui/components';

export interface RtoItemRowItem {
  readonly shipmentItemId: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly quantity: number;
  readonly rtoCondition: string | null;
  readonly rtoDisposition: string | null;
  readonly rtoInspectionNotes: string | null;
  /** Presigned by the API for this response; null when there is no image. */
  readonly thumbnailUrl: string | null;
}

const THUMB_PX = 72;

/**
 * The product picture beside a returned line.
 *
 * The inspector is judging condition with the box open, so what the
 * product is SUPPOSED to look like belongs next to the choice. Clicking
 * opens the same presigned URL in a new tab (the thumbnail is 400px wide,
 * big enough to compare against). No image → a neutral tile, not a
 * broken-image glyph.
 */
export function RtoLineThumb({
  src,
  productName,
}: {
  readonly src: string | null;
  readonly productName: string;
}): ReactElement {
  if (src === null) return <ProductThumb src={null} size={THUMB_PX} />;
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open the picture of ${productName} in a new tab`}
      className="shrink-0 rounded-[4px]"
    >
      <ProductThumb src={src} size={THUMB_PX} alt={productName} />
    </a>
  );
}

export function RtoItemRow({
  item,
  onSave,
  saving,
}: {
  readonly item: RtoItemRowItem;
  readonly onSave: (condition: string, disposition: string, notes?: string) => Promise<void>;
  readonly saving: boolean;
}): ReactElement {
  const [condition, setCondition] = useState(item.rtoCondition ?? '');
  const [disposition, setDisposition] = useState(item.rtoDisposition ?? '');
  const [notes, setNotes] = useState(item.rtoInspectionNotes ?? '');

  const inspected = item.rtoCondition !== null && item.rtoDisposition !== null;

  return (
    <div
      className={
        'p-3 rounded-[6px] border ' +
        (inspected
          ? 'border-[var(--color-accent-ring)] bg-[var(--color-accent-tint)]'
          : 'border-border')
      }
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex min-w-0 items-start gap-3">
          <RtoLineThumb src={item.thumbnailUrl} productName={item.productName} />
          <div className="min-w-0">
            <div className="text-text-bright text-sm break-words">
              {item.productName}
              {item.variantLabel ? (
                <span className="text-text-muted"> · {item.variantLabel}</span>
              ) : null}
            </div>
            <div className="text-text-faint text-xs font-mono break-all">
              {item.skuCode} · qty {item.quantity}
            </div>
          </div>
        </div>
        {inspected && <div className="text-accent text-xs shrink-0">✓ Inspected</div>}
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <FormField label="Condition">
          <Select
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            disabled={saving}
          >
            <option value="">—</option>
            <option value="GOOD">GOOD</option>
            <option value="DAMAGED">DAMAGED</option>
            <option value="MISSING">MISSING</option>
          </Select>
        </FormField>
        <FormField label="Disposition">
          <Select
            value={disposition}
            onChange={(e) => setDisposition(e.target.value)}
            disabled={saving}
          >
            <option value="">—</option>
            <option value="RESTOCK">RESTOCK</option>
            <option value="WRITE_OFF">WRITE_OFF</option>
          </Select>
        </FormField>
      </div>
      <FormField label="Notes">
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
          placeholder="Optional inspection notes"
          disabled={saving}
        />
      </FormField>
      <div className="flex justify-end mt-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={saving || !condition || !disposition}
          onClick={() => void onSave(condition, disposition, notes.trim() || undefined)}
        >
          {saving ? 'Saving…' : 'Save inspection'}
        </Button>
      </div>
    </div>
  );
}
