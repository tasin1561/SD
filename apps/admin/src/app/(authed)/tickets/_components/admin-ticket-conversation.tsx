'use client';

import { useState, type ReactElement } from 'react';
import { Button, SkeletonRows, Textarea, useToast } from '@skydrop/ui/components';
import {
  useCourierThread,
  useCourierThreadForTicket,
  useReplyToSellerOnTicket,
  useTicketEvents,
  type TicketView,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';

type Side = 'SELLER' | 'US' | 'COURIER';

interface Bubble {
  readonly key: string;
  readonly side: Side;
  readonly who: string;
  readonly body: string;
  readonly at: string;
}

/**
 * The same thread the seller sees, from our side of it.
 *
 * Deliberately the same shape as the seller's rather than an operator
 * variant: the two people in this conversation should be reading the
 * same thing, and an ops view that reorders or relabels it makes
 * "what did we tell them" a question you answer by opening two tabs.
 *
 * The SELLER's messages sit on the left here and on the right there —
 * the only difference, and the right one: each side sees its own words
 * as theirs.
 *
 * Status changes with no words stay out. They are in History below,
 * where bookkeeping belongs; a chat that lists "OPEN → OPEN" buries the
 * messages it exists to show.
 */
export function AdminTicketConversation({ ticket }: { readonly ticket: TicketView }): ReactElement {
  const toast = useToast();
  const events = useTicketEvents(ticket.id);
  const canSeeCourier = usePermission('courier.ops.view');
  const link = useCourierThreadForTicket(canSeeCourier ? ticket.id : null);
  const thread = useCourierThread(canSeeCourier ? (link.data?.id ?? null) : null);
  const reply = useReplyToSellerOnTicket();
  const canReply = usePermission('tickets.resolve');
  const [draft, setDraft] = useState('');

  const bubbles: Bubble[] = [];

  if (ticket.description !== null && ticket.description.trim() !== '') {
    bubbles.push({
      key: 'raised',
      side: 'SELLER',
      who: 'Seller',
      body: ticket.description,
      at: ticket.createdAt,
    });
  }

  for (const e of events.data ?? []) {
    // `?? ''` rather than a null check: the field arrives from an API
    // over a hand-written type, and a guard that assumes the shape is
    // exactly what turned a wrong field name into a blank page.
    const said = (e.note ?? '').trim();
    if (said === '' || said === 'Ticket opened') continue;
    const fromSeller = e.actorType === 'SELLER';
    bubbles.push({
      key: `note-${e.id}`,
      side: fromSeller ? 'SELLER' : 'US',
      who: fromSeller ? 'Seller' : 'Skydrop',
      body: said,
      at: e.createdAt,
    });
  }

  for (const m of thread.data?.messages ?? []) {
    bubbles.push({
      key: `courier-${m.id}`,
      // Only what the courier SAID is theirs; our message to them is
      // still us talking.
      side: m.direction === 'INBOUND' ? 'COURIER' : 'US',
      who: m.direction === 'INBOUND' ? 'Courier' : 'Skydrop → courier',
      body: m.body,
      at: m.occurredAt,
    });
  }

  bubbles.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const send = (): void => {
    const note = draft.trim();
    if (note === '') return;
    void (async () => {
      try {
        await reply.mutateAsync({ ticketId: ticket.id, note });
        setDraft('');
        toast.success('Sent — the seller can see it');
      } catch (err) {
        toast.error(serverVerdict(err));
      }
    })();
  };

  if (events.isLoading) return <SkeletonRows rows={3} cols={1} />;

  return (
    <>
      {bubbles.length === 0 ? (
        <p className="text-text-muted text-sm">Nothing said yet.</p>
      ) : (
        <ol className="space-y-3">
          {bubbles.map((b) => (
            <li key={b.key} className="flex justify-start">
              <div className="max-w-[85%]">
                <p className="text-text-muted mb-1 text-xs">
                  {b.who} ·{' '}
                  {new Date(b.at).toLocaleString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                <div
                  className={
                    b.side === 'SELLER'
                      ? 'bg-accent/10 border-accent/30 rounded-lg rounded-tl-sm border px-3 py-2 text-sm whitespace-pre-wrap'
                      : b.side === 'COURIER'
                        ? 'bg-warning/10 border-warning/30 rounded-lg rounded-tl-sm border px-3 py-2 text-sm whitespace-pre-wrap'
                        : 'bg-surface-raised border-border rounded-lg rounded-tl-sm border px-3 py-2 text-sm whitespace-pre-wrap'
                  }
                >
                  {b.body}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {ticket.resolvedAt === null && canReply ? (
        <div className="border-border mt-4 border-t pt-3">
          <Textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Reply to the seller — they read this on their own ticket."
            aria-label="Reply to the seller"
          />
          <div className="mt-2 flex justify-end">
            <Button
              variant="primary"
              size="sm"
              disabled={draft.trim() === '' || reply.isPending}
              onClick={send}
            >
              {reply.isPending ? 'Sending…' : 'Reply to seller'}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
