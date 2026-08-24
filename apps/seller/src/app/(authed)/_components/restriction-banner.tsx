'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { useSellerRestriction } from '@/lib/ops-hooks';

/**
 * On every page, because a hold changes what the whole portal will do.
 *
 * Leads with the NUMBER, not the refusal. A seller who is blocked and
 * told only that they are blocked has been given a problem; one who is
 * told exactly what to top up has been given a task. The amount is in
 * rupees and deliberately not converted — it has to match the payout and
 * top-up screens, where the figures are rupees too.
 */
export function RestrictionBanner(): ReactElement | null {
  const restriction = useSellerRestriction();
  const active = restriction.data ?? null;
  if (active === null) return null;

  return (
    <div
      role="status"
      className="border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] mb-4 rounded-lg border px-3 py-2.5"
    >
      <div className="flex items-start gap-2">
        <span className="text-critical mt-0.5 shrink-0">
          <AlertTriangle size={16} />
        </span>
        <div className="min-w-0 text-sm">
          <p className="text-text-bright font-medium">
            Top up <Money amount={active.shortfallInr} currency="INR" convert={false} /> to lift the
            hold on your account
          </p>
          <p className="text-text-body mt-0.5">{active.reason}</p>
          <p className="text-text-muted mt-1 text-xs">
            Your balance is <Money amount={active.balanceInr} currency="INR" convert={false} />; the
            hold clears on its own at{' '}
            <Money amount={active.clearAtBalanceInr} currency="INR" convert={false} />.{' '}
            <Link href="/wallet" className="text-accent underline">
              Go to your wallet
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
