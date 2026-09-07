'use client';

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Search } from 'lucide-react';
import { useOrdersList } from '@/lib/api-hooks';
import { usePermission } from '@/lib/use-permission';

/**
 * Find a parcel from anywhere.
 *
 * ── WHY IT REUSES THE ORDER LIST ─────────────────────────────────────
 * `/admin/orders?search=` already matches the order number, the
 * seller's own ref, the recipient's name, their phone AND the waybill —
 * every identifier a person would be holding when they need this. A
 * second endpoint would be a second definition of "found", and the two
 * would drift the first time either gained a field.
 *
 * ── IT WAITS FOR YOU TO STOP TYPING ──────────────────────────────────
 * Debounced, and only past two characters. Firing per keystroke would
 * put a cross-seller LIKE over the orders table on every letter, which
 * is the query least able to afford it.
 *
 * ── ENTER GOES STRAIGHT THERE WHEN THERE IS ONE ANSWER ───────────────
 * An AWB or an order number matches exactly one parcel, and making
 * somebody read a list of one to click it is a step for nothing. Two or
 * more, and the list is the answer.
 */
export function OrderOmnisearch(): ReactElement | null {
  const router = useRouter();
  const canSee = usePermission('orders.view');
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  // Close on a click anywhere else. Without this the panel sits over
  // the page after you have moved on and reads as part of it.
  useEffect(() => {
    function onDocClick(e: MouseEvent): void {
      if (boxRef.current !== null && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const enabled = canSee && debounced.length >= 2;
  const q = useOrdersList({ search: debounced, pageSize: 8 }, { enabled });
  const items = useMemo(() => q.data?.items ?? [], [q.data]);

  // Cosmetic gate (FE-2) — the server refuses regardless. A search box
  // that returns 403s to somebody who may not read orders is worse than
  // no search box.
  if (!canSee) return null;

  function go(orderId: string): void {
    setOpen(false);
    setTerm('');
    router.push(`/orders/${orderId}`);
  }

  return (
    <div ref={boxRef} className="relative w-[22rem] max-w-[34vw]">
      <div className="relative">
        <Search
          className="text-text-faint pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
          aria-hidden
        />
        {/*
          Styled like a real control, not left to `sd-field`.

          `sd-field` only sets a WIDTH — the border, ground and focus
          ring live on the Input primitive, and this is a raw input
          because it needs the icon inset. Without them the box rendered
          as a magnifier and some grey placeholder floating in the
          header, which reads as a label rather than something you can
          type into.
        */}
        <input
          className="sd-field bg-bg border-border text-text-bright placeholder:text-text-faint focus:border-accent focus:ring-accent/25 min-h-[34px] w-full rounded-[5px] border py-1.5 pr-3 pl-8 text-sm transition-colors focus:ring-2 focus:outline-none"
          type="search"
          value={term}
          placeholder="Order, AWB, name or phone…"
          aria-label="Find an order"
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            // One answer means the search WAS the click.
            if (e.key === 'Enter' && items.length === 1 && items[0] !== undefined) {
              go(items[0].id);
            }
          }}
        />
        {enabled && q.isFetching && (
          <Loader2
            className="text-text-faint absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin"
            aria-hidden
          />
        )}
      </div>

      {open && debounced.length >= 2 && (
        <div className="border-border bg-surface absolute right-0 z-50 mt-1 w-[22rem] max-w-[90vw] overflow-hidden rounded-md border shadow-lg">
          {q.isFetching && items.length === 0 ? (
            <p className="text-text-muted px-3 py-2 text-xs">Searching…</p>
          ) : items.length === 0 ? (
            <p className="text-text-muted px-3 py-2 text-xs">
              Nothing matches that. It searches the order number, the seller’s own reference, the
              recipient’s name and phone, and the waybill.
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className="hover:bg-surface-raised block w-full px-3 py-2 text-left"
                    onClick={() => go(o.id)}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-xs">{o.orderNumber}</span>
                      <span className="text-text-faint text-[11px] tracking-wide uppercase">
                        {o.status.replaceAll('_', ' ').toLowerCase()}
                      </span>
                    </div>
                    <div className="text-text-muted truncate text-xs">
                      {o.recipientName} · {o.recipientPhoneE164}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
