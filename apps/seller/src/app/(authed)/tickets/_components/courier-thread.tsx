'use client';

import type { ReactElement } from 'react';
import { MessageSquare } from 'lucide-react';
import { Card, CardBody, ErrorNote, SkeletonRows, StatusBadge } from '@skydrop/ui/components';
import { useCourierThreadForTicket, type CourierThreadMessage } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

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

  if (thread.isLoading) return <SkeletonRows rows={3} cols={1} />;
  if (thread.isError) {
    return <ErrorNote message={serverVerdict(thread.error)} retry={() => void thread.refetch()} />;
  }

  const data = thread.data;
  if (data === null || data === undefined) {
    // No conversation yet. Said plainly rather than hidden: a seller
    // wondering whether anyone has contacted the courier deserves an
    // answer, and "not yet" is an answer.
    return (
      <Card>
        <CardBody>
          <div className="flex items-start gap-3">
            <MessageSquare size={18} className="mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium">No courier conversation yet</p>
              <p className="text-text-muted mt-1">
                Our team opens one with the courier when a delivery needs chasing. Anything they say
                will appear here, in their words.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-medium">Message the courier</h3>
          {data.state !== null ? (
            <StatusBadge kind={badgeKind(data.state)} label={humanise(data.state)} />
          ) : null}
          {data.awbNumber !== null ? (
            <span className="text-text-muted text-xs">AWB {data.awbNumber}</span>
          ) : null}
          {data.pendingOutbound > 0 ? (
            <span className="text-text-muted text-xs">
              {data.pendingOutbound} message{data.pendingOutbound === 1 ? '' : 's'} queued to send
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          {data.messages.length === 0 ? (
            <p className="text-text-muted text-sm">
              The conversation is open; nothing has been said yet.
            </p>
          ) : (
            data.messages.map((m) => <Message key={m.id} message={m} />)
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function Message({ message }: { readonly message: CourierThreadMessage }): ReactElement {
  const fromCourier = message.direction === 'INBOUND';
  return (
    <div className={fromCourier ? '' : 'sm:pl-8'}>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium">{fromCourier ? 'Delhivery' : 'You'}</span>
        <span className="text-text-muted text-xs">
          {new Date(message.occurredAt).toLocaleString('en-IN')}
        </span>
        {message.state !== null ? (
          <StatusBadge kind={badgeKind(message.state)} label={humanise(message.state)} />
        ) : null}
      </div>
      {/* VERBATIM: pre-wrap, no truncation, no tidying. */}
      <pre
        className={`whitespace-pre-wrap rounded p-3 text-sm ${
          fromCourier ? 'bg-surface-2' : 'bg-surface-3'
        }`}
      >
        {message.body}
      </pre>
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
