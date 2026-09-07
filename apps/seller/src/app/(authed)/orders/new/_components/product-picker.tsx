'use client';

import { useMemo, useState, type ReactElement } from 'react';

import { Input, Money, ProductThumb } from '@skydrop/ui/components';
import type { SellerVariantSearchHit } from '@skydrop/api-client';
import { Check, Minus, Plus, Search, Star, X } from 'lucide-react';
import { useSetVariantFavourite, useVariantSearch } from '@/lib/api-hooks';

export interface PickedLine {
  readonly key: number;
  readonly variantId: string;
  readonly productId: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly imageUrl: string | null;
  readonly weightGrams: number | null;
  /**
   * The CATALOGUE value, kept apart from `unitPriceInr` which the seller
   * may edit. The server defaults the customs declared value from the
   * catalogue snapshot, so previewing it needs the catalogue figure — a
   * preview computed from the edited selling price would show a number
   * the order would not actually carry.
   */
  readonly catalogueValueInr: string | null;
  quantity: string;
  unitPriceInr: string;
}

export interface StockFigure {
  readonly available: number;
  readonly inTransit: number;
}

/**
 * The catalogue — a searchable list you click to add from.
 *
 * A LIST, not a select: a select cannot show a thumbnail, a price and a
 * stock figure per option, and those three are the whole reason somebody
 * is looking. The stacked product/variant dropdowns this replaced made
 * you decode a SKU to find the green one, and hid the two facts that
 * decide the line until after you had chosen.
 *
 * ONE search box. It was two — "Code / SKU" and "Name" — but the
 * endpoint already matches SKU, variant label AND product name, so the
 * pair were two ways to type into the same query while looking like a
 * choice about which column to search.
 */
export function ProductCatalogue({
  lines,
  stockByVariant,
  onAdd,
}: {
  readonly lines: readonly PickedLine[];
  readonly stockByVariant: ReadonlyMap<string, StockFigure>;
  readonly onAdd: (hit: SellerVariantSearchHit) => void;
}): ReactElement {
  const [query, setQuery] = useState('');
  /** Show only the starred ones. Off by default — a filter that hides
   *  most of the catalogue should never be the state you arrive in. */
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const setFavourite = useSetVariantFavourite();

  const results = useVariantSearch(query.trim());
  const hits = useMemo(() => {
    const all = results.data ?? [];
    return favouritesOnly ? all.filter((h) => h.isFavourite) : all;
  }, [results.data, favouritesOnly]);
  const chosen = useMemo(() => new Set(lines.map((l) => l.variantId)), [lines]);

  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="relative min-w-0 flex-1">
          <Search
            size={15}
            aria-hidden
            className="text-text-faint pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by SKU, product name or variant…"
            aria-label="Search the catalogue"
            className="pl-8"
          />
        </div>
        <button
          type="button"
          onClick={() => setFavouritesOnly((v) => !v)}
          aria-pressed={favouritesOnly}
          aria-label={favouritesOnly ? 'Show all products' : 'Show starred products only'}
          title={favouritesOnly ? 'Showing starred only' : 'Show starred only'}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] border ${
            favouritesOnly
              ? 'border-accent bg-[var(--color-accent-tint)] text-accent'
              : 'border-border text-text-muted hover:text-text-bright'
          }`}
        >
          <Star size={16} fill={favouritesOnly ? 'currentColor' : 'none'} aria-hidden />
        </button>
      </div>

      <div className="border-border-subtle max-h-[24rem] overflow-auto border-t">
        {results.isLoading ? (
          <p className="text-text-muted px-4 py-3 text-sm">Searching…</p>
        ) : hits.length === 0 ? (
          <p className="text-text-muted px-4 py-3 text-sm">
            {favouritesOnly
              ? 'Nothing starred yet. Tap a star to keep a product at the top of this list.'
              : query.trim() === ''
                ? 'Your active products appear here. Type to narrow them down.'
                : `Nothing matches “${query.trim()}”.`}
          </p>
        ) : (
          <ul>
            {hits.map((h) => {
              const s = stockByVariant.get(h.id);
              const available = s?.available ?? 0;
              const inTransit = s?.inTransit ?? 0;
              const already = chosen.has(h.id);
              // ADVISORY, never a refusal (ORD-10): stock landing on
              // Friday is exactly what the inbound flow is for. The row
              // is dimmed and the button says so, and it still adds.
              const none = available <= 0;
              return (
                <li
                  key={h.id}
                  className="border-border-subtle hover:bg-surface-hover flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0"
                >
                  <ProductThumb src={h.primaryImageUrl} size={40} />
                  <div className={`min-w-0 flex-1 ${none ? 'opacity-60' : ''}`}>
                    <p className="text-text-body truncate text-sm leading-snug">
                      {h.productName}
                      {h.variantLabel === null ? '' : ` — ${h.variantLabel}`}
                    </p>
                    <p className="text-text-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs">
                      <span className="truncate">{h.skuCode}</span>
                      <span aria-hidden className="text-text-faint">
                        ·
                      </span>
                      <span className={none ? 'text-[var(--status-failed-fg)]' : ''}>
                        {none ? 'out of stock' : `${available} in stock`}
                        {inTransit > 0 ? ` (+${inTransit} coming)` : ''}
                      </span>
                    </p>
                  </div>
                  <span className="text-text-body shrink-0 font-mono text-sm tabular-nums">
                    {h.effectiveDeclaredValueInr === null ? (
                      <span className="text-text-faint text-xs">No price</span>
                    ) : (
                      // convert={false} throughout: every field on this
                      // form is labelled "(INR)" and typed in rupees, so a
                      // taka figure beside a rupee input invites someone to
                      // type the converted number.
                      <Money amount={h.effectiveDeclaredValueInr} convert={false} />
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => onAdd(h)}
                    disabled={already}
                    aria-label={`Add ${h.skuCode}`}
                    className={`skydrop-hit inline-flex h-8 shrink-0 items-center gap-1 rounded-[4px] px-2.5 text-xs font-medium ${
                      already
                        ? 'bg-[var(--status-delivered-bg)] text-[var(--status-delivered-fg)]'
                        : 'border-accent text-accent hover:bg-[var(--color-accent-tint)] border'
                    }`}
                  >
                    {already ? <Check size={13} aria-hidden /> : <Plus size={13} aria-hidden />}
                    {already ? 'Added' : 'Add'}
                  </button>
                  {/*
                    Its OWN button, outside the add button. Nesting it
                    would make starring add the product too — and a
                    click that does two things is the one people stop
                    trusting.
                  */}
                  <button
                    type="button"
                    onClick={() =>
                      void setFavourite.mutateAsync({
                        variantId: h.id,
                        isFavourite: !h.isFavourite,
                      })
                    }
                    aria-pressed={h.isFavourite}
                    aria-label={`${h.isFavourite ? 'Unstar' : 'Star'} ${h.skuCode}`}
                    className={`skydrop-hit flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] ${
                      h.isFavourite
                        ? 'text-[var(--status-pending-fg)]'
                        : 'text-text-faint hover:text-text-muted'
                    }`}
                  >
                    <Star size={14} fill={h.isFavourite ? 'currentColor' : 'none'} aria-hidden />
                  </button>
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
 * What has been added — the order itself.
 *
 * Quantity is the thing that changes here; price is the thing that
 * occasionally does. So quantity gets the stepper on the row and price
 * is a field you can reach without opening anything, but neither is a
 * three-column grid of equal weight any more — the line total is the
 * number being checked.
 */
export function OrderedProducts({
  lines,
  stockByVariant,
  onPatch,
  onRemove,
}: {
  readonly lines: readonly PickedLine[];
  readonly stockByVariant: ReadonlyMap<string, StockFigure>;
  readonly onPatch: (key: number, patch: Partial<PickedLine>) => void;
  readonly onRemove: (key: number) => void;
}): ReactElement {
  if (lines.length === 0) {
    return (
      <p className="text-text-muted px-4 py-6 text-center text-sm">
        Nothing added yet. Pick from the catalogue above.
      </p>
    );
  }
  return (
    <ul className="flex flex-col">
      {lines.map((l) => {
        const s = stockByVariant.get(l.variantId);
        const qty = Number(l.quantity);
        const price = Number(l.unitPriceInr);
        const short = Number.isFinite(qty) && qty > (s?.available ?? 0);
        return (
          <li key={l.key} className="border-border-subtle border-b px-4 py-3 last:border-b-0">
            <div className="flex items-center gap-3">
              <ProductThumb src={l.imageUrl} size={40} />
              <div className="min-w-0 flex-1">
                <p className="text-text-body truncate text-sm leading-snug">
                  {l.productName}
                  {l.variantLabel === null ? '' : ` — ${l.variantLabel}`}
                </p>
                <p className="text-text-muted truncate font-mono text-xs">{l.skuCode}</p>
              </div>

              <Stepper
                value={l.quantity}
                min={1}
                onChange={(v) => onPatch(l.key, { quantity: v })}
                label={`Quantity of ${l.skuCode}`}
              />

              <span className="text-text-bright w-24 shrink-0 text-right font-mono text-sm tabular-nums">
                {Number.isFinite(qty) && Number.isFinite(price) ? (
                  <Money amount={qty * price} convert={false} />
                ) : (
                  '—'
                )}
              </span>

              <button
                type="button"
                onClick={() => onRemove(l.key)}
                aria-label={`Remove ${l.skuCode}`}
                className="text-text-faint hover:text-[var(--status-failed-fg)] skydrop-hit flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px]"
              >
                <X size={15} aria-hidden />
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-[52px]">
              <label className="text-text-muted flex items-center gap-2 text-xs">
                Unit price
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={l.unitPriceInr}
                  aria-label={`Unit price of ${l.skuCode}`}
                  onChange={(e) => onPatch(l.key, { unitPriceInr: e.target.value })}
                  className="border-border bg-surface text-text-body h-8 w-24 rounded-[4px] border px-2 text-xs tabular-nums [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:text-base"
                />
              </label>
              {short && (
                <span className="text-[var(--status-failed-fg)] text-xs">
                  only {s?.available ?? 0} available
                  {(s?.inTransit ?? 0) > 0 ? `, ${s?.inTransit} coming` : ''}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
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
    <span className="border-border flex shrink-0 items-stretch rounded-[4px] border">
      <button
        type="button"
        onClick={() => bump(-step)}
        aria-label={`Decrease ${label}`}
        className="text-text-muted hover:text-text-bright flex h-8 w-8 items-center justify-center [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
      >
        <Minus size={13} aria-hidden />
      </button>
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="border-border bg-surface text-text-body h-8 w-11 min-w-0 border-x text-center text-sm tabular-nums [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-14 [@media(pointer:coarse)]:text-base"
      />
      <button
        type="button"
        onClick={() => bump(step)}
        aria-label={`Increase ${label}`}
        className="text-text-muted hover:text-text-bright flex h-8 w-8 items-center justify-center [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
      >
        <Plus size={13} aria-hidden />
      </button>
    </span>
  );
}
