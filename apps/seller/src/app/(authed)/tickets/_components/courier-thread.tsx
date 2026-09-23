'use client';

import type { ReactElement } from 'react';
import { MessageSquare } from 'lucide-react';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useCourierThreadForTicket, type CourierThreadMessage } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import './tickets.css';

/**
 * The seller's conversation with the courier.
 *
 * ── THIS IS THE PRODUCT PROMISE, RENDERED ────────────────────────────
 * "Sellers report shipment problems in the Skydrop app and converse with
 * Delhivery support without a human relaying messages." Everything behind
 * it — the read pipeline, the outbox, the ops console, the portal worker —
 * existed before this component did, and none of it was reachable by a
 * seller. They could raise a ticket and never see a reply.
 *
 * ── READ-ONLY (2026-09-05) ───────────────────────────────────────────
 * The seller used to be able to write here. That went on a product
 * call: we are the operational backbone, and a seller in Dhaka does not
 * need an Indian operation precisely because they never deal with
 * Delhivery themselves. They tell us; we carry it. A message to a
 * courier cannot be unsent, so the choice of counterparty is not one to
 * put in front of somebody on every reply.
 *
 * Reading stays, and matters: this is where the seller sees the
 * courier's own words. On the ticket DETAIL page these messages are
 * merged into the single conversation instead, so this component is
 * used only by the list's expanded row, which has no other source.
 *
 * ── THE TEXT IS VERBATIM, IN BOTH DIRECTIONS ─────────────────────────
 * Rendered in a whitespace-preserving block with no truncation and no
 * tidying. The classifier's label drives the badge beside a message and
 * nothing else: the seller should feel they are reading the courier, and
 * a summarised or "improved" courier message is a different message.
 *
 * ── WHAT "SENT" MEANS HERE ───────────────────────────────────────────
 * A reply appears in the thread immediately and is queued for delivery
 * separately, because there is no courier write API — delivery is a human
 * in the ops console, or the portal worker once it is live. So the UI says
 * "queued to send" rather than "sent", which is the true statement.
 */
export function CourierThread({ ticketId }: { readonly ticketId: string }): ReactElement | null {
  const thread = useCourierThreadForTicket(ticketId);

  if (thread.isLoading) {
    return <SkeletonRows rows={3} cols={1} label="Loading the courier conversation…" />;
  }
  if (thread.isError) {
    return <ErrorState message={serverVerdict(thread.error)} retry={() => void thread.refetch()} />;
  }

  const data = thread.data;
  if (data === null || data === undefined) {
    // No conversation yet. Said plainly rather than hidden: a seller
    // wondering whether anyone has contacted the courier deserves an
    // answer, and "not yet" is an answer.
    return (
      <div className="tkt-card">
        <div className="tkt-courier__empty">
          <span className="tkt-courier__icon" aria-hidden>
            <MessageSquare size={16} />
          </span>
          <div>
            <p className="tkt-courier__lead">No courier conversation yet</p>
            <p className="tkt-courier__body">
              Our team opens one with the courier when a delivery needs chasing. Anything they say
              will appear here, in their words.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tkt-card">
      <div className="tkt-courier__head">
        <h3 className="tkt-courier__title">Message the courier</h3>
        {data.state !== null ? (
          <StatusChip kind={badgeKind(data.state)} label={humanise(data.state)} size="sm" />
        ) : null}
        {data.awbNumber !== null ? (
          <span className="tkt-muted">
            AWB <span className="sk-ident">{data.awbNumber}</span>
          </span>
        ) : null}
        {data.pendingOutbound > 0 ? (
          <span className="tkt-muted">
            {data.pendingOutbound} message{data.pendingOutbound === 1 ? '' : 's'} queued to send
          </span>
        ) : null}
      </div>

      <div className="tkt-courier__list">
        {data.messages.length === 0 ? (
          <p className="tkt-courier__body">The conversation is open; nothing has been said yet.</p>
        ) : (
          data.messages.map((m) => <Message key={m.id} message={m} />)
        )}
      </div>
    </div>
  );
}

function Message({ message }: { readonly message: CourierThreadMessage }): ReactElement {
  const fromCourier = message.direction === 'INBOUND';
  return (
    <div className="tkt-courier__msg" data-ours={fromCourier ? undefined : '1'}>
      <div className="tkt-courier__who">
        <strong>{fromCourier ? 'Delhivery' : 'You'}</strong>
        <span className="sk-figure">{new Date(message.occurredAt).toLocaleString('en-IN')}</span>
        {message.state !== null ? (
          <StatusChip kind={badgeKind(message.state)} label={humanise(message.state)} size="sm" />
        ) : null}
      </div>
      {/* VERBATIM: pre-wrap, no truncation, no tidying. */}
      <pre className="tkt-courier__text">{message.body}</pre>
    </div>
  );
}

/** State label → a semantic colour. The label is data; the mapping is ours. */
function badgeKind(state: string): 'pending' | 'in-transit' | 'delivered' | 'failed' | 'draft' {
  switch (state) {
    case 'OUT_FOR_DELIVERY':
      return 'in-transit';
    case 'ACKNOWLEDGED':
      return 'pending';
    case 'ACTION_REQUIRED':
      return 'failed';
    default:
      // An unrecognised label is shown, not hidden: a new state the
      // classifier learned should be visible rather than silently blank.
      return 'draft';
  }
}

function humanise(state: string): string {
  return state.toLowerCase().replace(/_/g, ' ');
}
