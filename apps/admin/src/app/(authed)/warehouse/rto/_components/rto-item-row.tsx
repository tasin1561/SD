'use client';

import { useState, type ReactElement } from 'react';
import { Button, FormField, Input, ProductThumb, Select } from '@skydrop/ui/components';

export interface RtoItemRowInspection {
  readonly quantity: number;
  readonly condition: string;
  readonly disposition: string;
  readonly notes: string | null;
}

export interface RtoItemRowItem {
  readonly shipmentItemId: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly quantity: number;
  readonly rtoCondition: string | null;
  readonly rtoDisposition: string | null;
  readonly rtoInspectionNotes: string | null;
  /** WMS-8d — the line by quantity; one row when unsplit, empty until inspected. */
  readonly rtoInspections?: ReadonlyArray<RtoItemRowInspection>;
  /** Presigned by the API for this response; null when there is no image. */
  readonly thumbnailUrl: string | null;
}

/**
 * What a save sends: one decision for the whole line, or the line split by
 * quantity. The server checks the rows add up to the line (FE-2 — this
 * screen shows the arithmetic, it does not enforce it).
 */
export type RtoInspectPayload =
  | { readonly condition: string; readonly disposition: string; readonly notes?: string }
  | {
      readonly rows: ReadonlyArray<{
        readonly quantity: number;
        readonly condition: string;
        readonly disposition: string;
        readonly notes?: string;
      }>;
    };

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
    value: 'HOLD_DAMAGED',
    label: 'Keep aside (damaged)',
    effect:
      'Goes into this warehouse’s Damaged bin at finalise — kept for the seller, never sellable, and no inbound freight is charged. Finalise refuses if the warehouse has no Damaged bin. To send it back or scrap it later: Inventory → Adjustments, a decrease from the Damaged bin with reason “returned to seller” or “damaged in warehouse”.',
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

const DISPOSITION_HINT =
  'Put back in stock: returns hold, sellable once shelved. Keep aside (damaged): the Damaged bin, kept for the seller and never sold. Write off: nothing goes back into stock and the seller is charged its share of inbound freight. Decide later: keeps it in the returns hold; the parcel cannot be finalised until you choose.';

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
  if (disposition === 'HOLD_DAMAGED' && condition === 'GOOD') {
    return 'Keeping a good unit aside means it can never be sold. Put it back in stock instead?';
  }
  if (disposition === 'HOLD_DAMAGED' && condition === 'MISSING') {
    return 'A missing unit is not here to keep aside — you probably mean Write off.';
  }
  if (disposition === 'WRITE_OFF' && condition === 'GOOD') {
    return 'Writing off a good unit removes sellable stock for good. Put it back in stock instead?';
  }
  return null;
}

interface SplitRowState {
  readonly quantity: string;
  readonly condition: string;
  readonly disposition: string;
  readonly notes: string;
}

function parseQty(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 ? n : null;
}

/** The live arithmetic under a split: how many units still need a decision. */
export function remainingLabel(lineQuantity: number, rows: readonly SplitRowState[]): string {
  const decided = rows.reduce((sum, r) => sum + (parseQty(r.quantity) ?? 0), 0);
  const left = lineQuantity - decided;
  if (left === 0) return `All ${lineQuantity} units have a decision.`;
  if (left > 0) return `${left} of ${lineQuantity} units still need a decision.`;
  return `${-left} more than the ${lineQuantity} units on this line.`;
}

function initialSplit(item: RtoItemRowItem): SplitRowState[] | null {
  const rows = item.rtoInspections ?? [];
  if (rows.length < 2) return null;
  return rows.map((r) => ({
    quantity: String(r.quantity),
    condition: r.condition,
    disposition: r.disposition,
    notes: r.notes ?? '',
  }));
}

export function RtoItemRow({
  item,
  onSave,
  saving,
}: {
  readonly item: RtoItemRowItem;
  readonly onSave: (payload: RtoInspectPayload) => Promise<void>;
  readonly saving: boolean;
}): ReactElement {
  const [condition, setCondition] = useState(item.rtoCondition ?? '');
  const [disposition, setDisposition] = useState(item.rtoDisposition ?? '');
  const [notes, setNotes] = useState(item.rtoInspectionNotes ?? '');
  // null ⇒ one decision for the whole line (the default).
  const [split, setSplit] = useState<SplitRowState[] | null>(() => initialSplit(item));

  const inspected = item.rtoCondition !== null && item.rtoDisposition !== null;
  const mismatch = dispositionMismatch(condition, disposition);
  const selected = DISPOSITION_OPTIONS.find((o) => o.value === disposition);

  function startSplit(): void {
    // Two rows to start: the first unit, and the rest of the line — the
    // owner's case is "one good, one damaged", and the inspector adjusts.
    setSplit([
      { quantity: '1', condition, disposition, notes: '' },
      {
        quantity: String(Math.max(1, item.quantity - 1)),
        condition: '',
        disposition: '',
        notes: '',
      },
    ]);
  }
  function updateRow(i: number, patch: Partial<SplitRowState>): void {
    setSplit((rows) =>
      rows === null ? rows : rows.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    );
  }

  const splitReady =
    split !== null &&
    split.length > 0 &&
    split.every((r) => parseQty(r.quantity) !== null && r.condition !== '' && r.disposition !== '');

  function save(): void {
    if (split !== null) {
      void onSave({
        rows: split.map((r) => ({
          quantity: parseQty(r.quantity) ?? 0,
          condition: r.condition,
          disposition: r.disposition,
          ...(r.notes.trim() ? { notes: r.notes.trim() } : {}),
        })),
      });
      return;
    }
    void onSave({
      condition,
      disposition,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
  }

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

      {split === null ? (
        <>
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
              hint={DISPOSITION_HINT}
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
        </>
      ) : (
        <div className="space-y-2" aria-label="Split by quantity">
          <p className="text-text-muted text-xs" role="status" aria-live="polite">
            {remainingLabel(item.quantity, split)}
          </p>
          {split.map((row, i) => {
            const rowMismatch = dispositionMismatch(row.condition, row.disposition);
            const rowEffect = DISPOSITION_OPTIONS.find((o) => o.value === row.disposition);
            return (
              <div key={i} className="rounded-[5px] border border-border p-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[6rem_1fr_1fr]">
                  <FormField label={`Units (row ${i + 1})`}>
                    <Input
                      inputMode="numeric"
                      value={row.quantity}
                      onChange={(e) => updateRow(i, { quantity: e.target.value })}
                      disabled={saving}
                      aria-label={`Units in row ${i + 1}`}
                    />
                  </FormField>
                  <FormField label="Condition">
                    <Select
                      value={row.condition}
                      onChange={(e) => updateRow(i, { condition: e.target.value })}
                      disabled={saving}
                      aria-label={`Condition, row ${i + 1}`}
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
                    label="What happens to them"
                    {...(rowMismatch === null ? {} : { notice: rowMismatch })}
                  >
                    <Select
                      value={row.disposition}
                      onChange={(e) => updateRow(i, { disposition: e.target.value })}
                      disabled={saving}
                      aria-label={`What happens to them, row ${i + 1}`}
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
                {rowEffect === undefined ? null : (
                  <p className="text-text-muted mt-1 text-xs">{rowEffect.effect}</p>
                )}
                <div className="mt-2 flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <FormField label="Notes">
                      <Input
                        value={row.notes}
                        onChange={(e) => updateRow(i, { notes: e.target.value })}
                        maxLength={1000}
                        placeholder="Optional"
                        disabled={saving}
                        aria-label={`Notes, row ${i + 1}`}
                      />
                    </FormField>
                  </div>
                  {split.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={saving}
                      onClick={() => setSplit(split.filter((_, j) => j !== i))}
                    >
                      Remove row
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2">
            {split.length < item.quantity && (
              <Button
                variant="secondary"
                size="sm"
                disabled={saving}
                onClick={() =>
                  setSplit([...split, { quantity: '1', condition: '', disposition: '', notes: '' }])
                }
              >
                Add row
              </Button>
            )}
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => setSplit(null)}>
              One decision for all {item.quantity}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 mt-2">
        {split === null && item.quantity > 1 && (
          <Button variant="ghost" size="sm" disabled={saving} onClick={startSplit}>
            Split by quantity
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          disabled={saving || (split === null ? !condition || !disposition : !splitReady)}
          onClick={save}
        >
          {saving ? 'Saving…' : 'Save inspection'}
        </Button>
      </div>
    </div>
  );
}
