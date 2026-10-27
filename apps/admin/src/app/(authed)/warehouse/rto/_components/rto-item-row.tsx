'use client';

import { useState, type ReactElement } from 'react';
import { Check } from 'lucide-react';
import { ProductThumb } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { Select } from '@skydrop/ui/app/select';
import { TextField } from '@skydrop/ui/app/text-field';
import '../../_components/benches.css';
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import { tEn, type MessageKey } from '@/i18n/catalog';

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
  const tr = useT();
  if (src === null) return <ProductThumb src={null} size={THUMB_PX} />;
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={tr('warehouseRtoRtoItemRow.openThePictureOfIn', { productName })}
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
export const CONDITION_OPTIONS = (tr: Translate<MessageKey>) =>
  [
    { value: 'GOOD', label: tr('warehouseRtoRtoItemRow.goodSellableAsNew') },
    { value: 'DAMAGED', label: tr('warehouseRtoRtoItemRow.damaged') },
    { value: 'MISSING', label: tr('warehouseRtoRtoItemRow.missingFromTheBox') },
  ] as const;

export const dispositionOptions = (tr: Translate<MessageKey>) =>
  [
    {
      value: 'RESTOCK',
      label: tr('warehouseRtoRtoItemRow.putBackInStock'),
      effect: tr('warehouseRtoRtoItemRow.sellableImmediatelyAtFinaliseIt'),
    },
    {
      value: 'HOLD_DAMAGED',
      label: tr('warehouseRtoRtoItemRow.keepAsideDamaged'),
      effect: tr('warehouseRtoRtoItemRow.movesFromTheReturnsHold'),
    },
    {
      value: 'WRITE_OFF',
      label: tr('warehouseRtoRtoItemRow.writeOffNotSellable'),
      effect: tr('warehouseRtoRtoItemRow.removedFromTheReturnsHold'),
    },
    {
      value: 'INSPECT_LATER',
      label: tr('warehouseRtoRtoItemRow.decideLater'),
      effect: tr('warehouseRtoRtoItemRow.staysInTheReturnsHold'),
    },
  ] as const;

/** The English reading of the table above — what specs and non-React callers import. */
export const DISPOSITION_OPTIONS = dispositionOptions(tEn);

/**
 * WMS-8e: a received return is already IN the returns hold (booked at
 * receive), so each choice says where it goes FROM there at finalise.
 */
const DISPOSITION_HINT = (tr: Translate<MessageKey>) =>
  tr('warehouseRtoRtoItemRow.everythingReceivedWaitsInThe');

/**
 * A combination that is allowed but usually a slip — said out loud, never
 * refused (the server is the only authority on what may be saved).
 */
export function dispositionMismatchIn(
  tr: Translate<MessageKey>,
  condition: string,
  disposition: string,
): string | null {
  if (disposition === 'RESTOCK' && (condition === 'DAMAGED' || condition === 'MISSING')) {
    return condition === 'MISSING'
      ? tr('warehouseRtoRtoItemRow.mismatchMissingRestock')
      : tr('warehouseRtoRtoItemRow.mismatchDamagedRestock');
  }
  if (disposition === 'HOLD_DAMAGED' && condition === 'GOOD') {
    return tr('warehouseRtoRtoItemRow.mismatchGoodHold');
  }
  if (disposition === 'HOLD_DAMAGED' && condition === 'MISSING') {
    return tr('warehouseRtoRtoItemRow.mismatchMissingHold');
  }
  if (disposition === 'WRITE_OFF' && condition === 'GOOD') {
    return tr('warehouseRtoRtoItemRow.mismatchGoodWriteOff');
  }
  return null;
}

export function dispositionMismatch(condition: string, disposition: string): string | null {
  return dispositionMismatchIn(tEn, condition, disposition);
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
export function remainingLabelIn(
  tr: Translate<MessageKey>,
  lineQuantity: number,
  rows: readonly SplitRowState[],
): string {
  const decided = rows.reduce((sum, r) => sum + (parseQty(r.quantity) ?? 0), 0);
  const left = lineQuantity - decided;
  if (left === 0) return tr('warehouseRtoRtoItemRow.remainingAll', { lineQuantity });
  if (left > 0) return tr('warehouseRtoRtoItemRow.remainingSome', { left, lineQuantity });
  return tr('warehouseRtoRtoItemRow.remainingOver', { over: -left, lineQuantity });
}

export function remainingLabel(lineQuantity: number, rows: readonly SplitRowState[]): string {
  return remainingLabelIn(tEn, lineQuantity, rows);
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
  const tr = useT();
  const [condition, setCondition] = useState(item.rtoCondition ?? '');
  const [disposition, setDisposition] = useState(item.rtoDisposition ?? '');
  const [notes, setNotes] = useState(item.rtoInspectionNotes ?? '');
  // null ⇒ one decision for the whole line (the default).
  const [split, setSplit] = useState<SplitRowState[] | null>(() => initialSplit(item));

  const inspected = item.rtoCondition !== null && item.rtoDisposition !== null;
  const mismatch = dispositionMismatchIn(tr, condition, disposition);
  const selected = dispositionOptions(tr).find((o) => o.value === disposition);

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
              <span className="sk-figure">
                {tr('warehouseRtoRtoItemRow.qty', { quantity: item.quantity })}
              </span>
            </div>
          </div>
        </div>
        {inspected && (
          <span className="wh-tag" data-tone="good">
            <Check size={12} aria-hidden /> {tr('warehouseRtoRtoItemRow.inspected')}
          </span>
        )}
      </div>

      {split === null ? (
        <>
          <div className="wh-fields" data-cols="2">
            <Select
              label={tr('warehouseRtoRtoItemRow.condition')}
              hint={tr('warehouseRtoRtoItemRow.whatYouFoundInThe')}
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              disabled={saving}
              aria-label={tr('warehouseRtoRtoItemRow.condition')}
            >
              <option value="">—</option>
              {CONDITION_OPTIONS(tr).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select
              label={tr('warehouseRtoRtoItemRow.whatHappensToIt')}
              {...(mismatch === null ? {} : { notice: mismatch })}
              value={disposition}
              onChange={(e) => setDisposition(e.target.value)}
              disabled={saving}
              aria-label={tr('warehouseRtoRtoItemRow.whatHappensToIt')}
            >
              <option value="">—</option>
              {dispositionOptions(tr).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          {selected === undefined ? null : <p className="wh-note">{selected.effect}</p>}
          <details className="wh-details">
            <summary>{tr('warehouseRtoRtoItemRow.whatEachChoiceDoes')}</summary>
            <p>{DISPOSITION_HINT(tr)}</p>
          </details>
          <TextField
            label={tr('warehouseRtoRtoItemRow.notes')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
            placeholder={tr('warehouseRtoRtoItemRow.optionalInspectionNotes')}
            disabled={saving}
          />
        </>
      ) : (
        <div
          className="wh-stack wh-stack--tight"
          aria-label={tr('warehouseRtoRtoItemRow.splitByQuantity')}
        >
          <p className="wh-note" role="status" aria-live="polite">
            {remainingLabelIn(tr, item.quantity, split)}
          </p>
          {split.map((row, i) => {
            const rowMismatch = dispositionMismatchIn(tr, row.condition, row.disposition);
            const rowEffect = dispositionOptions(tr).find((o) => o.value === row.disposition);
            return (
              <div key={i} className="wh-split-row">
                <div className="wh-fields" data-cols="split">
                  <TextField
                    label={tr('warehouseRtoRtoItemRow.unitsRow', { value: i + 1 })}
                    inputMode="numeric"
                    inputClassName="sk-figure"
                    value={row.quantity}
                    onChange={(e) => updateRow(i, { quantity: e.target.value })}
                    disabled={saving}
                    aria-label={tr('warehouseRtoRtoItemRow.unitsInRow', { value: i + 1 })}
                  />
                  <Select
                    label={tr('warehouseRtoRtoItemRow.condition')}
                    value={row.condition}
                    onChange={(e) => updateRow(i, { condition: e.target.value })}
                    disabled={saving}
                    aria-label={tr('warehouseRtoRtoItemRow.conditionRow', { value: i + 1 })}
                  >
                    <option value="">—</option>
                    {CONDITION_OPTIONS(tr).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                  <Select
                    label={tr('warehouseRtoRtoItemRow.whatHappensToThem')}
                    {...(rowMismatch === null ? {} : { notice: rowMismatch })}
                    value={row.disposition}
                    onChange={(e) => updateRow(i, { disposition: e.target.value })}
                    disabled={saving}
                    aria-label={tr('warehouseRtoRtoItemRow.whatHappensToThemRow', { value: i + 1 })}
                  >
                    <option value="">—</option>
                    {dispositionOptions(tr).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
                {rowEffect === undefined ? null : <p className="wh-note">{rowEffect.effect}</p>}
                <div className="wh-fields wh-split-notes">
                  <TextField
                    label={tr('warehouseRtoRtoItemRow.notes')}
                    value={row.notes}
                    onChange={(e) => updateRow(i, { notes: e.target.value })}
                    maxLength={1000}
                    placeholder={tr('warehouseRtoRtoItemRow.optional')}
                    disabled={saving}
                    aria-label={tr('warehouseRtoRtoItemRow.notesRow', { value: i + 1 })}
                  />
                  {split.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={saving}
                      onClick={() => setSplit(split.filter((_, j) => j !== i))}
                    >
                      {tr('warehouseRtoRtoItemRow.removeRow')}
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
                {tr('warehouseRtoRtoItemRow.addRow')}
              </Button>
            )}
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => setSplit(null)}>
              {tr('warehouseRtoRtoItemRow.oneDecisionForAll', { quantity: item.quantity })}
            </Button>
          </div>
        </div>
      )}

      <div className="wh-row wh-row--end">
        {split === null && item.quantity > 1 && (
          <Button variant="ghost" size="sm" disabled={saving} onClick={startSplit}>
            {tr('warehouseRtoRtoItemRow.splitByQuantity')}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          disabled={saving || (split === null ? !condition || !disposition : !splitReady)}
          onClick={save}
        >
          {saving
            ? tr('warehouseRtoRtoItemRow.saving')
            : tr('warehouseRtoRtoItemRow.saveInspection')}
        </Button>
      </div>
    </div>
  );
}
