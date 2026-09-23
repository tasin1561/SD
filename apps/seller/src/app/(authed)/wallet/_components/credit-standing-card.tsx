'use client';

import type { ReactElement } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { useCreditStanding } from '@/lib/ops-hooks';
import { WalCallout } from './wallet-parts';

/**
 * How far into the red this wallet may go.
 *
 * Shown BEFORE an order is refused, not after. Being told "no" at the
 * moment you try to place an order, with no warning it was coming, is
 * the version of this that makes people distrust the platform — so the
 * headroom is on the page while it is still comfortable.
 *
 * Rendered only when the balance is actually negative. A seller in
 * credit does not need to be told about an overdraft they are not
 * using; it would read as a warning about nothing.
 *
 * Drawn as a callout: red with a warning sign when new orders are
 * paused, amber with an info sign while there is still room — the icon
 * and the title say which, so the colour is never the only signal.
 */
export function CreditStandingCard(): ReactElement | null {
  const q = useCreditStanding();

  if (q.isLoading || q.isError || q.data === undefined) return null;
  if (Number(q.data.balanceInr) >= 0) return null;

  const d = q.data;

  return (
    <WalCallout
      tone={d.blocked ? 'critical' : 'warn'}
      role={d.blocked ? 'alert' : undefined}
      icon={d.blocked ? <AlertTriangle size={16} /> : <Info size={16} />}
      title={d.blocked ? 'New orders are paused' : 'Your balance is negative'}
    >
      {d.blocked ? (
        <p>{d.reason}</p>
      ) : (
        <p>
          You are <Money amount={d.balanceInr} currency="INR" /> overdrawn. There is{' '}
          <Money amount={d.headroomInr} currency="INR" /> of room left before new orders pause.
        </p>
      )}
      {Number(d.stockValueInr) > 0 && (
        <p className="wal-callout__aside">
          Your stock with us is worth <Money amount={d.stockValueInr} currency="INR" /> at cost, and
          that is most of what lets the balance go below zero at all. It clears as those goods sell
          — or top up to clear it now.
        </p>
      )}
    </WalCallout>
  );
}
