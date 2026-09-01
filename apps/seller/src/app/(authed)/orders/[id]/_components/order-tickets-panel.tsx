'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { Button, Card, CardBody, SkeletonRows, TicketStatusBadge } from '@skydrop/ui/components';
import { useSellerTickets } from '@/lib/ops-hooks';
import { RaiseTicketModal } from '../../../tickets/_components/raise-ticket-modal';

/**
 * Every conversation open on this parcel, and a way to start another.
 *
 * An order can carry SEVERAL tickets — a re-attempt, then a recall,
 * then "it arrived broken" — and they are deliberately not collapsed
 * into one. They are different questions with different answers, and
 * merging them loses which reply belonged to which.
 *
 * Resolved ones stay listed rather than being hidden: "we already asked
 * about this and here is what they said" is the most useful thing on
 * the page when the same problem comes back.
 */
export function OrderTicketsPanel({ orderId }: { readonly orderId: string }): ReactElement {
  const tickets = useSellerTickets({ orderId });
  const [raising, setRaising] = useState(false);
  const rows = tickets.data ?? [];

  return (
    <Card className="mt-4">
      <CardBody>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Issues raised on this order</h2>
          <Button variant="secondary" size="sm" onClick={() => setRaising(true)}>
            Raise an issue
          </Button>
        </div>

        {tickets.isLoading ? (
          <SkeletonRows rows={2} cols={1} />
        ) : rows.length === 0 ? (
          <p className="text-text-muted text-sm">
            Nothing raised yet. If something is wrong with this parcel, tell us and we will take it
            up with the courier.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/tickets/${t.id}`}
                  className="border-border hover:border-accent flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm"
                >
                  <TicketStatusBadge status={t.status} />
                  <span className="flex-1">{t.subject}</span>
                  <span className="text-text-muted text-xs tabular-nums">
                    {new Date(t.createdAt).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      {/* The order is already known, so it is not asked for again. */}
      <RaiseTicketModal open={raising} onOpenChange={setRaising} orderId={orderId} />
    </Card>
  );
}
