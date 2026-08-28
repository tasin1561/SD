'use client';

import type { ReactElement } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Card, CardBody, CardHeader, Money } from '@skydrop/ui/components';
import { useCreditStanding } from '@/lib/ops-hooks';

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
 */
export function CreditStandingCard(): ReactElement | null {
  const q = useCreditStanding();

  if (q.isLoading || q.isError || q.data === undefined) return null;
  if (Number(q.data.balanceInr) >= 0) return null;

  const d = q.data;

  return (
    <Card>
      <CardHeader title={d.blocked ? 'New orders are paused' : 'Your balance is negative'} />
      <CardBody>
        <div className="flex gap-2">
          {d.blocked ? (
            <AlertTriangle className="text-danger mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <Info className="text-text-muted mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          <div className="space-y-2 text-sm">
            {d.blocked ? (
              <p>{d.reason}</p>
            ) : (
              <p>
                You are <Money amount={d.balanceInr} currency="INR" /> overdrawn. There is{' '}
                <Money amount={d.headroomInr} currency="INR" /> of room left before new orders
                pause.
              </p>
            )}
            {Number(d.stockValueInr) > 0 && (
              <p className="text-text-muted text-xs">
                Your stock with us is worth <Money amount={d.stockValueInr} currency="INR" /> at
                cost, and that is most of what lets the balance go below zero at all. It clears as
                those goods sell — or top up to clear it now.
              </p>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
