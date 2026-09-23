'use client';

import { useState, type ReactElement } from 'react';
import { Check } from 'lucide-react';
import { ProductThumb } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { Select } from '@skydrop/ui/app/select';
import { TextField } from '@skydrop/ui/app/text-field';
import '../../_components/benches.css';

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
      className="wh-thumb-link"
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
      'Sellable immediately: at finalise it moves out of the returns hold onto the floor bin — or, when this warehouse tracks bins, back to the shelf it was picked from.',
  },
  {
    value: 'HOLD_DAMAGED',
    label: 'Keep aside (damaged)',
    effect:
      'Moves from the returns hold into this warehouse’s Damaged bin at finalise — kept for the seller, never sellable, and no inbound freight is charged. Finalise refuses if the warehouse has no Damaged bin. To send it back or scrap it later: Inventory → Adjustments, a decrease from the Damaged bin with reason “returned to seller” or “damaged in warehouse”.',
  },
  {
    value: 'WRITE_OFF',
    label: 'Write off (not sellable)',
    effect:
      'Removed from the returns hold at finalise, and from stock for good. The seller is charged this unit’s share of inbound freight; any refund for the goods is decided on the damage ticket.',
  },
  {
    value: 'INSPECT_LATER',
    label: 'Decide later',
    effect:
      'Stays in the returns hold, unsellable. The parcel cannot be finalised until every line has a decision.',
  },
] as const;

/**
 * WMS-8e: a received return is already IN the returns hold (booked at
 * receive), so each choice says where it goes FROM there at finalise.
 */
const DISPOSITION_HINT =
  'Everything received waits in the returns hold until you decide. Put back in stock: sellable immediately (the floor bin, or its old shelf when bins are tracked). Keep aside (damaged): the Damaged bin, kept for the seller and never sold. Write off: removed from the returns hold and from stock, and the seller is charged its share of inbound freight. Decide later: stays in the returns hold; the parcel cannot be finalised until you choose.';

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
    <div className="wh-item" data-done={inspected ? '1' : undefined}>
      <div className="wh-item__head">
        <div className="wh-item__who">
          <RtoLineThumb src={item.thumbnailUrl} productName={item.productName} />
          <div className="wh-min0">
            <div className="wh-item__name">
              {item.productName}
              {item.variantLabel ? <span className="wh-note"> · {item.variantLabel}</span> : null}
            </div>
            <div className="wh-item__sub">
              <span className="sk-ident">{item.skuCode}</span> ·{' '}
              <span className="sk-figure">qty {item.quantity}</span>
            </div>
          </div>
        </div>
        {inspected && (
          <span className="wh-tag" data-tone="good">
            <Check size={12} aria-hidden /> Inspected
          </span>
        )}
      </div>

      {split === null ? (
        <>
          <div className="wh-fields" data-cols="2">
            <Select
              label="Condition"
              hint="What you found in the box. Damaged or Missing opens a damage ticket to the seller, which is where any refund is decided."
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
            <Select
              label="What happens to it"
              {...(mismatch === null ? {} : { notice: mismatch })}
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
          </div>
          {selected === undefined ? null : <p className="wh-note">{selected.effect}</p>}
          <details className="wh-details">
            <summary>What each choice does</summary>
            <p>{DISPOSITION_HINT}</p>
          </details>
          <TextField
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
            placeholder="Optional inspection notes"
            disabled={saving}
          />
        </>
      ) : (
        <div className="wh-stack wh-stack--tight" aria-label="Split by quantity">
          <p className="wh-note" role="status" aria-live="polite">
            {remainingLabel(item.quantity, split)}
          </p>
          {split.map((row, i) => {
            const rowMismatch = dispositionMismatch(row.condition, row.disposition);
            const rowEffect = DISPOSITION_OPTIONS.find((o) => o.value === row.disposition);
            return (
              <div key={i} className="wh-split-row">
                <div className="wh-fields" data-cols="split">
                  <TextField
                    label={`Units (row ${i + 1})`}
                    inputMode="numeric"
                    inputClassName="sk-figure"
                    value={row.quantity}
                    onChange={(e) => updateRow(i, { quantity: e.target.value })}
                    disabled={saving}
                    aria-label={`Units in row ${i + 1}`}
                  />
                  <Select
                    label="Condition"
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
                  <Select
                    label="What happens to them"
                    {...(rowMismatch === null ? {} : { notice: rowMismatch })}
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
                </div>
                {rowEffect === undefined ? null : <p className="wh-note">{rowEffect.effect}</p>}
                <div className="wh-fields wh-split-notes">
                  <TextField
                    label="Notes"
                    value={row.notes}
                    onChange={(e) => updateRow(i, { notes: e.target.value })}
                    maxLength={1000}
                    placeholder="Optional"
                    disabled={saving}
                    aria-label={`Notes, row ${i + 1}`}
                  />
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
          <div className="wh-row">
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

      <div className="wh-row wh-row--end">
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
