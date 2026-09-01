'use client';

import type { ReactElement } from 'react';
import { useTicketTimeline } from '@/lib/ops-hooks';

/**
 * What has happened on a ticket, in the order it happened.
 *
 * The load-bearing entries are the ones an operator wrote: "we rang the
 * customer, they will be in on Saturday". A RECALL ticket has no courier
 * conversation to show — our own agents make the call — so without this
 * the seller asks for something and then watches a status field that
 * never explains anything.
 *
 * Renders nothing at all until there is more than the opening entry:
 * a timeline whose only row is "Ticket opened" tells nobody anything
 * they cannot already see from the ticket sitting in front of them.
 */
export function TicketTimeline({ ticketId }: { readonly ticketId: string }): ReactElement | null {
  const timeline = useTicketTimeline(ticketId);
  const entries = (timeline.data ?? []).filter((e) => e.note !== null && e.note.trim() !== '');
  if (entries.length <= 1) return null;

  return (
    <div className="border-border mt-3 border-t pt-3">
      <p className="text-text-muted mb-2 text-xs font-medium tracking-wide uppercase">Updates</p>
      <ol className="space-y-2">
        {entries.map((e, i) => (
          <li key={`${e.at}-${i}`} className="text-sm">
            <span className="text-text-muted mr-2 text-xs tabular-nums">
              {new Date(e.at).toLocaleString('en-IN', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <span>{e.note}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
