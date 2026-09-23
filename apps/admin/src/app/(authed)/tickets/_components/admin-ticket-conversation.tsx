'use client';

import { useState, type ReactElement } from 'react';
import { Send } from 'lucide-react';
// The legacy `useToast` stays: the conversation test mounts this under the
// legacy Toaster only. `MessageRelayStatus` has no app equivalent.
import { MessageRelayStatus, useToast } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { TextArea } from '@skydrop/ui/app/text-field';
import { PaperPlaneSendButton } from '@skydrop/ui/app/paper-plane-send';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import {
  useCourierThread,
  useCourierThreadForTicket,
  useMarkTicketMessageRelayed,
  useReplyToSellerOnTicket,
  useTicketEvents,
  type TicketView,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import '@/app/(authed)/system/_components/af.css';

type Side = 'SELLER' | 'US' | 'COURIER';

interface Bubble {
  readonly key: string;
  readonly side: Side;
  readonly who: string;
  readonly body: string;
  readonly at: string;
  /**
   * TKT-2 — the seller's own messages carry where they have got to, and
   * the id of the row that records it. Both undefined on ours and the
   * courier's: neither has anywhere further to travel.
   */
  readonly eventId?: string;
  readonly relayedAt?: string | null;
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
  const relay = useMarkTicketMessageRelayed();
  const canReply = usePermission('tickets.resolve');
  const [draft, setDraft] = useState('');

  const bubbles: Bubble[] = [];

  /*
    The opening message's text lives on the ticket; its EVENT is the
    companion "Ticket opened" row `open()` writes. Matched on the note
    rather than on position, because a scrap ticket is opened by staff
    and its opening event is not the seller speaking.
  */
  const openingEvent = (events.data ?? []).find(
    (e) => (e.note ?? '').trim() === 'Ticket opened' && e.actorType === 'SELLER',
  );

  // The opening message sits with WHOEVER OPENED the ticket: the seller's
  // words on a seller issue, ours on a ticket we opened (a scrap/damage
  // claim off an RTO inspection) — which used to be drawn as the seller's.
  if (ticket.description !== null && ticket.description.trim() !== '') {
    const theirs = ticket.openedBy === 'SELLER';
    bubbles.push({
      key: 'raised',
      side: theirs ? 'SELLER' : 'US',
      who: theirs ? 'Seller' : 'Skydrop',
      body: ticket.description,
      at: ticket.createdAt,
      ...(theirs && openingEvent !== undefined
        ? { eventId: openingEvent.id, relayedAt: openingEvent.relayedAt }
        : {}),
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
      ...(fromSeller ? { eventId: e.id, relayedAt: e.relayedAt } : {}),
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

  /*
    TKT-2 — "I have taken this to the courier."

    An operator action, on the message it refers to, rather than a
    checkbox somewhere else on the page: what is being asserted is about
    THIS sentence, and a control that sits away from it is one you have
    to match up by eye.

    Idempotent server-side, so a double-click is not an error — the
    toast says which happened rather than pretending the second call did
    something.
  */
  const markRelayed = (eventId: string): void => {
    void (async () => {
      try {
        const res = await relay.mutateAsync({ ticketId: ticket.id, eventId });
        toast.success(
          res.alreadyRelayed
            ? 'Already marked — the seller can see it'
            : 'Marked as passed to the courier — the seller can see it',
        );
      } catch (err) {
        toast.error(serverVerdict(err));
      }
    })();
  };

  /*
    Returns the real request, so the send button's paper plane flies only
    after the reply has actually been saved; a refusal rejects, the plane
    stays put, and the server's verdict is toasted verbatim.
  */
  const send = async (): Promise<void> => {
    const note = draft.trim();
    if (note === '') return;
    try {
      await reply.mutateAsync({ ticketId: ticket.id, note });
      setDraft('');
      toast.success('Sent — the seller can see it');
    } catch (err) {
      toast.error(serverVerdict(err));
      throw err;
    }
  };

  if (events.isLoading) return <SkeletonRows rows={3} cols={1} label="Loading the conversation" />;

  return (
    <>
      {bubbles.length === 0 ? (
        <p className="af-muted">Nothing said yet.</p>
      ) : (
        <ol className="af-thread">
          {bubbles.map((b) => {
            /*
              The SELLER sits on the right, here and on their own ticket
              page. Everything used to be left-aligned, so two voices in
              one thread were told apart only by a small grey label —
              which is not how anybody reads a conversation.

              Right for the seller rather than for US, deliberately: the
              seller app already puts their words on the right, so the
              thread has the same shape whichever side you read it from.
              A thread that mirrors depending on who is logged in is one
              nobody can screenshot and discuss.

              `justify-end` / `justify-start` stay on the row: the
              conversation test reads them.
            */
            const sellerSide = b.side === 'SELLER';
            // Hoisted so the closure below keeps the narrowing — a
            // `?? ''` there would post an empty id rather than not
            // rendering the button.
            const eventId = b.eventId;
            return (
              <li
                key={b.key}
                className={
                  sellerSide
                    ? 'af-thread__row flex justify-end'
                    : 'af-thread__row flex justify-start'
                }
              >
                <div className="af-bubble" data-side={b.side}>
                  <p className="af-bubble__who">
                    {b.who} ·{' '}
                    {new Date(b.at).toLocaleString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  <div className="af-bubble__text">{b.body}</div>
                  {b.relayedAt === undefined ? null : (
                    <div className="af-bubble__relay">
                      <MessageRelayStatus relayedAt={b.relayedAt} />
                      {b.relayedAt === null && canReply && eventId !== undefined ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={relay.isPending}
                          onClick={() => markRelayed(eventId)}
                        >
                          Mark delivered
                        </Button>
                      ) : null}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {ticket.resolvedAt === null && canReply ? (
        <div className="af-reply">
          <TextArea
            label="Reply to the seller"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Reply to the seller — they read this on their own ticket."
            // Display only: the server's limit on a note (AddTicketNoteDto,
            // 2000), shown so a long reply is not a surprise — never enforced.
            countMax={2000}
          />
          <div className="af-row af-row--end">
            <PaperPlaneSendButton
              label="Reply to seller"
              busyLabel="Sending…"
              doneLabel="Sent"
              errorLabel="Not sent"
              size="sm"
              icon={<Send size={14} />}
              disabled={draft.trim() === '' || reply.isPending}
              onAction={send}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
