'use client';

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { ComboSelect, type ComboOption } from '@skydrop/ui/app/combo-select';
import { statusLabel } from '@skydrop/ui/status';
import { useOrdersList } from '@/lib/api-hooks';

/** Long enough that a stray keystroke does not hit the API. */
const MIN_QUERY = 2;
/** The same 250 ms the header's order search and the ticket list use. */
const DEBOUNCE_MS = 250;
const PAGE_SIZE = 8;

/**
 * Choose one of your orders.
 *
 * ── WHY A PICKER AND NOT A WIDER LOOKUP ──────────────────────────────
 * "Raise an issue" asked for an order by UUID, with the hint "copy the
 * ID from the order page" — and that page shows a NUMBER. So the hint
 * described something the seller could not do, and the field could only
 * be filled by somebody who knew to open dev tools or read a URL.
 *
 * The obvious fix is to accept the number too. That was rejected:
 * `TicketService.open`'s scoped order lookup is the TENANT BOUNDARY and
 * is shared by five callers, four of which already hand it a uuid they
 * resolved from their own scoped read — so widening it would add a
 * second definition of "which order is this" to a security-relevant
 * query, reachable by one caller, for the sake of accepting a second
 * spelling of a thing a person should not be typing at all.
 *
 * A picker removes the transcription step instead of tolerating it.
 * Nothing is typed that has to be right.
 *
 * ── WHY IT SEARCHES THE ORDERS LIST AND NOT SOMETHING NEW ────────────
 * `GET /seller/orders?search=` already matches the order number, the
 * seller's own reference, the recipient's name, their phone AND the
 * waybill. A second endpoint would be a second definition of "found",
 * and the two would drift. (`OrderOmnisearch` makes the same argument
 * for the header search; this is the keyboard-navigable version of it,
 * which that one is not.)
 *
 * Remote mode on `ComboSelect` is load-bearing here: the server matches
 * on a phone number the option's LABEL never shows, so filtering the
 * result again in the browser would fetch the right order and then hide
 * it.
 */
export function OrderPicker({
  value,
  onChange,
  label = 'Order',
  hint,
  disabled,
}: {
  readonly value: string | null;
  readonly onChange: (orderId: string | null) => void;
  readonly label?: string;
  readonly hint?: string;
  readonly disabled?: boolean;
}): ReactElement {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const enabled = debounced.length >= MIN_QUERY;
  const list = useOrdersList({ search: debounced, pageSize: PAGE_SIZE }, { enabled });

  const options = useMemo<ComboOption[]>(
    () =>
      (list.data?.items ?? []).map((o) => ({
        value: o.id,
        // The NUMBER is the label, because that is what the seller reads
        // on every other screen and would say down a phone.
        label: o.orderNumber,
        description: `${o.recipientName} · ${o.recipientPhoneE164} · ${statusLabel(o.status)}`,
      })),
    [list.data],
  );

  return (
    <ComboSelect
      id="order-picker"
      label={label}
      hint={hint}
      disabled={disabled}
      remote
      options={options}
      value={value}
      onChange={(next) => onChange(next)}
      onQueryChange={setQuery}
      placeholder="Order number, name, phone or waybill…"
      autoComplete="off"
      emptyText={
        !enabled
          ? 'Type an order number, a name, a phone number or a waybill'
          : list.isFetching
            ? 'Searching…'
            : 'No order of yours matches that'
      }
    />
  );
}
