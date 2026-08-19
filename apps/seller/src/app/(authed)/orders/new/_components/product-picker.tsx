'use client';

import { useMemo, useState, type ReactElement } from 'react';
import { Input, Money, Num } from '@skydrop/ui/components';
import type { SellerVariantSearchHit } from '@skydrop/api-client';
import { useVariantSearch } from '@/lib/api-hooks';

export interface PickedLine {
  readonly key: number;
  readonly variantId: string;
  readonly productId: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly imageUrl: string | null;
  readonly weightGrams: number | null;
  quantity: string;
  unitPriceInr: string;
}

export interface StockFigure {
  readonly available: number;
  readonly inTransit: number;
}

/**
 * Two panels: the catalogue on the left, the order on the right.
 *
 * The stacked product/variant dropdowns it replaces made you decode a SKU
 * to find the green one, and hid the two facts that decide the line —
 * what it costs and whether we have it — until after you had chosen. Here
 * both are on the row you are about to click, next to a picture.
 *
 * The left panel is a LIST, not a select: a select cannot show a
 * thumbnail, a price and a stock figure per option, and those three are
 * the whole reason somebody is looking.
 */
export function ProductPicker({
  lines,
  stockByVariant,
  onAdd,
  onPatch,
  onRemove,
}: {
  readonly lines: readonly PickedLine[];
  readonly stockByVariant: ReadonlyMap<string, StockFigure>;
  readonly onAdd: (hit: SellerVariantSearchHit) => void;
  readonly onPatch: (key: number, patch: Partial<PickedLine>) => void;
  readonly onRemove: (key: number) => void;
}): ReactElement {
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');

  // One query. The endpoint already matches SKU, variant label AND
  // product name, so two boxes searching different columns would be two
  // round trips answering the same question — they are joined instead,
  // and each still reads as the thing it filters.
  const query = `${sku} ${name}`.trim();
  const results = useVariantSearch(query);
  const hits = useMemo(() => results.data ?? [], [results.data]);
  const chosen = useMemo(() => new Set(lines.map((l) => l.variantId)), [lines]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* ── Catalogue ─────────────────────────────────────────── */}
      <div className="border-border rounded-[8px] border">
        <div className="border-border-subtle border-b p-3">
          <h3 className="text-text-bright mb-2 text-sm font-medium">Click to add products</h3>
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="Code / SKU"
              aria-label="Search by code or SKU"
            />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              aria-label="Search by product name"
            />
          </div>
        </div>

        <div className="max-h-[26rem] overflow-auto">
          {results.isLoading ? (
            <p className="text-text-muted p-3 text-sm">Searching…</p>
          ) : hits.length === 0 ? (
            <p className="text-text-muted p-3 text-sm">
              {query === ''
                ? 'Your active products appear here. Type to narrow them down.'
                : `Nothing matches “${query}”.`}
            </p>
          ) : (
            <ul>
              {hits.map((h) => {
                const s = stockByVariant.get(h.id);
                const already = chosen.has(h.id);
                return (
                  <li key={h.id} className="border-border-subtle border-b last:border-b-0">
                    <button
                      type="button"
                      onClick={() => onAdd(h)}
                      disabled={already}
                      className="hover:bg-surface-hover flex w-full items-center gap-3 p-3 text-left disabled:opacity-50"
                    >
                      {h.primaryImageUrl !== null ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={h.primaryImageUrl}
                          alt=""
                          className="border-border h-11 w-11 shrink-0 rounded-[4px] border object-cover"
                        />
                      ) : (
                        <span
                          className="border-border bg-surface-raised h-11 w-11 shrink-0 rounded-[4px] border"
                          aria-hidden
                        />
                      )}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-text-body text-sm leading-snug">
                          {h.productName}
                          {h.variantLabel === null ? '' : ` — ${h.variantLabel}`}
                        </span>
                        <span className="text-text-muted font-mono text-xs">{h.skuCode}</span>
                        <span className="text-text-muted flex flex-wrap gap-3 text-xs">
                          <span>
                            {h.effectiveDeclaredValueInr === null ? (
                              'No price set'
                            ) : (
                              <Money amount={h.effectiveDeclaredValueInr} />
                            )}
                          </span>
                          <span
                            className={
                              (s?.available ?? 0) > 0 ? '' : 'text-[var(--status-failed-fg)]'
                            }
                          >
                            Stock: <Num value={s?.available ?? 0} />
                            {(s?.inTransit ?? 0) > 0 ? ` (+${s?.inTransit} in transit)` : ''}
                          </span>
                        </span>
                      </span>
                      {already && <span className="text-text-faint text-xs">Added</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ── The order ─────────────────────────────────────────── */}
      <div className="border-border rounded-[8px] border">
        <div className="border-border-subtle flex items-center justify-between border-b p-3">
          <h3 className="text-text-bright text-sm font-medium">Ordered products</h3>
          <span className="text-text-muted text-xs">
            {lines.length} {lines.length === 1 ? 'item' : 'items'}
          </span>
        </div>

        {lines.length === 0 ? (
          <p className="text-text-muted p-3 text-sm">
            Nothing added yet. Pick from the list on the left.
          </p>
        ) : (
          <ul className="flex flex-col">
            {lines.map((l) => {
              const s = stockByVariant.get(l.variantId);
              const qty = Number(l.quantity);
              const price = Number(l.unitPriceInr);
              const short = Number.isFinite(qty) && qty > (s?.available ?? 0);
              return (
                <li key={l.key} className="border-border-subtle border-b p-3 last:border-b-0">
                  <div className="flex items-start gap-3">
                    {l.imageUrl !== null ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={l.imageUrl}
                        alt=""
                        className="border-border h-11 w-11 shrink-0 rounded-[4px] border object-cover"
                      />
                    ) : (
                      <span
                        className="border-border bg-surface-raised h-11 w-11 shrink-0 rounded-[4px] border"
                        aria-hidden
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-text-body text-sm leading-snug">
                        {l.productName}
                        {l.variantLabel === null ? '' : ` — ${l.variantLabel}`}
                      </p>
                      <p className="text-text-muted font-mono text-xs">{l.skuCode}</p>
                      {short && (
                        <p className="text-[var(--status-failed-fg)] mt-0.5 text-xs">
                          only {s?.available ?? 0} available
                          {(s?.inTransit ?? 0) > 0 ? `, ${s?.inTransit} in transit` : ''}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemove(l.key)}
                      aria-label={`Remove ${l.skuCode}`}
                      className="text-text-muted hover:text-[var(--status-failed-fg)] shrink-0 text-xs underline"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-text-muted text-xs">Qty</span>
                      <Stepper
                        value={l.quantity}
                        min={1}
                        onChange={(v) => onPatch(l.key, { quantity: v })}
                        label={`Quantity of ${l.skuCode}`}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-text-muted text-xs">Price</span>
                      <Stepper
                        value={l.unitPriceInr}
                        min={0}
                        step={10}
                        onChange={(v) => onPatch(l.key, { unitPriceInr: v })}
                        label={`Unit price of ${l.skuCode}`}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-text-muted text-xs">Total</span>
                      <span className="border-border bg-surface-raised text-text-body flex h-10 items-center rounded-[6px] border px-2.5 text-sm tabular-nums">
                        {Number.isFinite(qty) && Number.isFinite(price)
                          ? (qty * price).toLocaleString('en-IN', { minimumFractionDigits: 2 })
                          : '—'}
                      </span>
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * A number with − and + either side.
 *
 * The buttons exist because this is used one-handed on a phone at a desk
 * with a customer on the line, where nudging a quantity is far more
 * common than typing one. The field stays typable for the case where it
 * is not.
 */
function Stepper({
  value,
  onChange,
  min,
  step = 1,
  label,
}: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly min: number;
  readonly step?: number;
  readonly label: string;
}): ReactElement {
  const n = Number(value);
  const bump = (by: number): void => {
    const base = Number.isFinite(n) ? n : min;
    onChange(String(Math.max(min, base + by)));
  };
  return (
    <span className="flex items-stretch">
      <button
        type="button"
        onClick={() => bump(-step)}
        aria-label={`Decrease ${label}`}
        className="border-border text-text-muted hover:text-text-bright h-10 w-9 shrink-0 rounded-l-[6px] border text-sm"
      >
        −
      </button>
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="border-border bg-surface text-text-body h-10 w-full min-w-0 border-y text-center text-sm tabular-nums"
      />
      <button
        type="button"
        onClick={() => bump(step)}
        aria-label={`Increase ${label}`}
        className="border-border text-text-muted hover:text-text-bright h-10 w-9 shrink-0 rounded-r-[6px] border text-sm"
      >
        +
      </button>
    </span>
  );
}
