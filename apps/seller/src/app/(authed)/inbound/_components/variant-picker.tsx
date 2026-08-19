'use client';

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Input } from '@skydrop/ui/components';
import { useSellerIdentity } from '@skydrop/auth/client';
import { can } from '@/lib/page-access';
import { useVariantSearch } from '@/lib/api-hooks';

/**
 * Choose a variant by name, not by uuid.
 *
 * The field this replaces asked for a "Variant id" with the hint "From
 * your catalog", which is a uuid a seller has no way to know and no
 * screen that shows it. They know "the green aviators" or the SKU they
 * printed on the box.
 *
 * Searching happens SERVER-side (`/seller/variants?search=`) rather than
 * by loading the catalogue and filtering here: the order form already
 * carries a comment admitting the load-everything approach breaks past a
 * hundred products, and a consignment is exactly when a seller has many.
 *
 * The chosen variant is held as a label, so a picked line reads back as
 * what it is instead of turning into a uuid the moment it is selected.
 */
export function VariantPicker({
  id,
  value,
  label,
  onPick,
}: {
  readonly id: string;
  /** The selected variant id, or '' for nothing yet. */
  readonly value: string;
  /** What to show once picked; null while nothing is. */
  readonly label: string | null;
  readonly onPick: (variantId: string, label: string) => void;
}): ReactElement {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  /**
   * Searching the catalogue needs `catalog.view`, and this page is gated
   * on `inbound.view` — they are different permissions, so a role that
   * can announce a consignment cannot necessarily read the catalogue.
   * Without this check the picker would fire a request that role may not
   * make and show them a 403 for doing nothing but opening a field.
   *
   * Cosmetic in the FE-2 sense — the server still refuses — but the point
   * is not sending a request nobody may make.
   */
  const maySearch = can(useSellerIdentity(), 'catalog.view');

  // Only ask once there is something to match on, only while the list is
  // open — a closed picker should cost nothing — and only if this role
  // may ask at all.
  const enabled = maySearch && open && query.trim().length >= 1;
  const results = useVariantSearch(query.trim(), { enabled });

  useEffect(() => {
    function onDocClick(e: MouseEvent): void {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const hits = useMemo(() => results.data ?? [], [results.data]);
  const picked = value !== '' && label !== null;

  return (
    <div ref={boxRef} className="relative">
      <Input
        id={id}
        value={picked && !open ? label : query}
        placeholder="Search by product or SKU"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
      />
      {open && (
        <div
          id={`${id}-listbox`}
          role="listbox"
          className="border-border bg-surface absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-[6px] border shadow-[var(--shadow-2)]"
        >
          {!maySearch ? (
            <p className="text-text-muted px-3 py-2 text-xs">
              Searching the catalogue needs catalogue access, which this account does not have. Ask
              a colleague who has it to add the lines, or paste the SKU they give you.
            </p>
          ) : query.trim() === '' ? (
            <p className="text-text-muted px-3 py-2 text-xs">Type a product name or SKU.</p>
          ) : results.isLoading ? (
            <p className="text-text-muted px-3 py-2 text-xs">Searching…</p>
          ) : hits.length === 0 ? (
            <p className="text-text-muted px-3 py-2 text-xs">
              Nothing matches “{query.trim()}”. Only active variants appear here.
            </p>
          ) : (
            hits.map((h) => {
              const shown =
                h.variantLabel === null || h.variantLabel === ''
                  ? h.productName
                  : `${h.productName} — ${h.variantLabel}`;
              return (
                <button
                  key={h.id}
                  type="button"
                  role="option"
                  aria-selected={h.id === value}
                  className="hover:bg-surface-hover flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left"
                  onClick={() => {
                    onPick(h.id, shown);
                    setQuery('');
                    setOpen(false);
                  }}
                >
                  <span className="text-text-body text-sm">{shown}</span>
                  <span className="text-text-muted font-mono text-xs">{h.skuCode}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
