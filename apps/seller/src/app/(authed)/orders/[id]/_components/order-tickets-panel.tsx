'use client';

import Link from 'next/link';
import { type ReactElement } from 'react';
import { LifeBuoy } from 'lucide-react';
import { ticketStatusKind, ticketStatusLabel } from '@skydrop/ui/status';
import { ListRow, ListRows } from '@skydrop/ui/app/list-row';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { OrdSection } from '../../_components/orders-parts';
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
export function OrderTicketsPanel({
  orderId,
  raising,
  onRaisingChange,
}: {
  readonly orderId: string;
  /**
   * The raise dialog, driven from the page header — the button lives
   * beside the order number now, with the other thing a seller can DO.
   * Lifted rather than duplicated: two buttons for one action is the
   * shape that made the ticket page confusing.
   */
  readonly raising: boolean;
  readonly onRaisingChange: (next: boolean) => void;
}): ReactElement {
  const tickets = useSellerTickets({ orderId });
  const setRaising = onRaisingChange;
  const rows = tickets.data ?? [];

  return (
    <OrdSection title="Issues raised on this order">
      {tickets.isLoading ? (
        <SkeletonRows rows={2} cols={1} label="Loading issues…" />
      ) : rows.length === 0 ? (
        <EmptyState
          bare
          icon={<LifeBuoy size={20} />}
          title="Nothing raised yet"
          description="If something is wrong with this parcel, tell us and we will take it up with the courier."
        />
      ) : (
        <ListRows label="Issues raised on this order">
          {rows.map((t) => (
            <ListRow
              key={t.id}
              href={`/tickets/${t.id}`}
              Link={Link}
              title={t.subject}
              status={
                <StatusChip
                  kind={ticketStatusKind(t.status)}
                  label={ticketStatusLabel(t.status)}
                  size="sm"
                />
              }
              age={new Date(t.createdAt).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
              })}
            />
          ))}
        </ListRows>
      )}

      {/* The order is already known, so it is not asked for again. */}
      <RaiseTicketModal open={raising} onOpenChange={setRaising} orderId={orderId} />
    </OrdSection>
  );
}
