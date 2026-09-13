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

/**
 * The words on the bench. The values are the API's enum (FE-2 — the
 * server decides); the labels say what each one DOES, because "WRITE_OFF"
 * told the inspector nothing about stock, freight or the seller.
 */
export const CONDITION_OPTIONS = [
  { value: 'GOOD', label: 'Good — sellable as new' },
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'MISSING', label: 'Missing from the box' },
] as const;

export const DISPOSITION_OPTIONS = [
  {
    value: 'RESTOCK',
    label: 'Put back in stock',
    effect:
      'Goes to the returns hold at finalise, and becomes sellable once it is shelved from “On the bench”.',
  },
  {
    value: 'WRITE_OFF',
    label: 'Write off (not sellable)',
    effect:
      'Nothing goes back into stock. The seller is charged this unit’s share of inbound freight; any refund for the goods is decided on the damage ticket.',
  },
  {
    value: 'INSPECT_LATER',
    label: 'Decide later',
    effect:
      'Stays in the returns hold, unsellable. The parcel cannot be finalised until every line has a decision.',
  },
] as const;

/**
 * A combination that is allowed but usually a slip — said out loud, never
 * refused (the server is the only authority on what may be saved).
 */
export function dispositionMismatch(condition: string, disposition: string): string | null {
  if (disposition === 'RESTOCK' && (condition === 'DAMAGED' || condition === 'MISSING')) {
    return condition === 'MISSING'
      ? 'A missing unit cannot go back on the shelf — you probably mean Write off.'
      : 'A damaged unit put back in stock will be sold to the next customer. Is it really sellable?';
  }
  if (disposition === 'WRITE_OFF' && condition === 'GOOD') {
    return 'Writing off a good unit removes sellable stock for good. Put it back in stock instead?';
  }
  return null;
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
  const mismatch = dispositionMismatch(condition, disposition);
  const selected = DISPOSITION_OPTIONS.find((o) => o.value === disposition);

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
      <div className="grid grid-cols-1 gap-2 mb-2 sm:grid-cols-2">
        <FormField
          label="Condition"
          hint="What you found in the box. Damaged or Missing opens a damage ticket to the seller, which is where any refund is decided."
        >
          <Select
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            disabled={saving}
            aria-label="Condition"
          >
            <option value="">—</option>
            {CONDITION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label="What happens to it"
          hint="Put back in stock: the unit goes to the returns hold and is sellable once shelved. Write off: nothing goes back into stock and the seller is charged its share of inbound freight. Decide later: keeps it in the returns hold; the parcel cannot be finalised until you choose."
          {...(mismatch === null ? {} : { notice: mismatch })}
        >
          <Select
            value={disposition}
            onChange={(e) => setDisposition(e.target.value)}
            disabled={saving}
            aria-label="What happens to it"
          >
            <option value="">—</option>
            {DISPOSITION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      {selected === undefined ? null : (
        <p className="text-text-muted mb-2 text-xs">{selected.effect}</p>
      )}
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
