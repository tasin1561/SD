import Link from 'next/link';
import type { ReactElement } from 'react';

/** A bin type in words an operator uses. */
export function binTypeLabel(type: string): string {
  switch (type) {
    case 'STORAGE':
      return 'Storage';
    case 'PICKING':
      return 'Picking';
    case 'RECEIVING':
      return 'Receiving';
    case 'PACKING':
      return 'Packing';
    case 'RTO_HOLD':
      return 'Returns hold';
    case 'DAMAGED':
      return 'Damaged';
    case 'QUARANTINE':
      return 'Quarantine';
    case 'TRANSIT':
      return 'In transit';
    default:
      return type;
  }
}

/**
 * What stock in a non-pickable bin MEANS — said plainly, because a number
 * sitting in "R-01-01" reads as stock you can sell, and it is not (BIN-2).
 * Nothing for an ordinary shelf.
 */
export function BinNote({ type }: { readonly type: string }): ReactElement | null {
  switch (type) {
    case 'RTO_HOLD':
      return (
        <p className="stk-note bin-note" data-tone="bad">
          Returns received but not yet decided — waiting to be inspected, or marked &ldquo;decide
          later&rdquo;. Not sellable. Finalising each return moves it on (back into stock, to the
          damaged bin, or written off) —{' '}
          <Link href="/warehouse/rto?tab=bench" className="stk-link">
            decide them at the RTO station (On the bench)
          </Link>
          .
        </p>
      );
    case 'DAMAGED':
      return (
        <p className="stk-note bin-note" data-tone="bad">
          Held back from sale. Nothing is picked from a damaged bin.
        </p>
      );
    case 'QUARANTINE':
      return (
        <p className="stk-note bin-note" data-tone="bad">
          Held back from sale until somebody decides what happens to it.
        </p>
      );
    case 'TRANSIT':
      return (
        <p className="stk-note bin-note">
          On its way from another warehouse. Counted here so neither building&rsquo;s count finds it
          missing; sellable once it arrives and is received.
        </p>
      );
    default:
      return null;
  }
}
