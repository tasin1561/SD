'use client';

import type { ReactElement } from 'react';
import { useState } from 'react';
import { Send } from 'lucide-react';
// The toast stays on the legacy provider for now: `ticket-conversation.test.tsx`
// mounts only the legacy `<Toaster>`, and the app `useToast` throws outside
// its own provider. The authed shell mounts both, so the page itself works
// with either; moving this one is a one-line change once the test mounts
// the app `ToastProvider` too.
import { MessageRelayStatus, useToast } from '@skydrop/ui/components';
import { PaperPlaneSendButton } from '@skydrop/ui/app/paper-plane-send';
import { TextArea } from '@skydrop/ui/app/text-field';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useCourierThreadForTicket,
  useReplyOnTicket,
  useTicketTimeline,
  type TicketView,
} from '@/lib/ops-hooks';
import './tickets.css';

type Side = 'SELLER' | 'US' | 'COURIER';

interface Bubble {
  readonly key: string;
  readonly side: Side;
  readonly who: string;
  readonly body: string;
  readonly at: string;
  /**
   * TKT-2 — where THIS message has got to, on the seller's own
   * messages. Undefined on ours and the courier's: neither has anywhere
   * further to travel, so a status there would be noise.
   */
  readonly relayedAt?: string | null;
}

/**
 * One thread: what the seller asked, what we found out, what the courier
 * said.
 *
 * This replaced a status audit trail sitting above a separate courier
 * box. Between them a seller had to read two lists in two shapes and
 * work out the order themselves — while the thing they actually wanted,
 * "what did you find out", was a grey line under a status label.
 *
 * A conversation is what it always was, so it is laid out as one. The
 * merge is chronological across BOTH sources for the same reason: our
 * reply and the courier's answer are turns in one exchange, and
 * separating them by origin is a filing decision the reader has to undo.
 *
 * Status changes with no words attached are deliberately NOT bubbles —
 * "Open → Negotiating" is bookkeeping, and putting it in a chat makes
 * the messages harder to find, not the history clearer.
 */
export function TicketConversation({ ticket }: { readonly ticket: TicketView }): ReactElement {
  const timeline = useTicketTimeline(ticket.id);
  const courier = useCourierThreadForTicket(ticket.id);
  const reply = useReplyOnTicket();
  const toast = useToast();
  const [draft, setDraft] = useState('');
  // A reply onto a closed ticket reaches nobody. The server refuses it
  // either way (FE-2); not offering the box is so the seller does not
  // write a paragraph to find that out.
  const isOpen = ticket.resolvedAt === null;

  /**
   * The real request. It rejects on a refusal (after showing the server's
   * verdict) so the send button shows the failure it really had and the
   * paper plane flies only after a real success.
   */
  const send = async (): Promise<void> => {
    const note = draft.trim();
    if (note === '') return;
    try {
      await reply.mutateAsync({ ticketId: ticket.id, note });
      setDraft('');
    } catch (err) {
      toast.error(serverVerdict(err));
      throw err;
    }
  };

  const bubbles: Bubble[] = [];

  /*
    The opening message has no event row of its own — the text lives on
    the ticket, and `open()` writes a companion "Ticket opened" event.
    So its relay state is that event's, matched the same way the loop
    below skips it.

    Matched on the NOTE rather than on "the first event": a scrap ticket
    is opened by staff, and crediting its opening event to the seller
    would offer to relay something the seller never wrote.
  */
  const openingEvent = (timeline.data ?? []).find(
    (e) => (e.note ?? '').trim() === 'Ticket opened' && e.actorType === 'SELLER',
  );

  // The opening message, on the side of WHOEVER OPENED the ticket. A
  // seller's issue opens with their words; a ticket we opened (damage
  // found on a return) opens with ours, and drawing that as "You" put
  // words in the seller's mouth they had never said.
  if (ticket.description !== null && ticket.description.trim() !== '') {
    const theirs = ticket.openedBy === 'SELLER';
    bubbles.push({
      key: 'raised',
      side: theirs ? 'SELLER' : 'US',
      who: theirs ? 'You' : 'Skydrop',
      body: ticket.description,
      at: ticket.createdAt,
      // Spread rather than `: undefined` — under
      // exactOptionalPropertyTypes an optional property may be absent,
      // not explicitly undefined. Only a seller's own message has a
      // relay state; ours has nowhere further to travel.
      ...(theirs && openingEvent !== undefined ? { relayedAt: openingEvent.relayedAt } : {}),
    });
  }

  for (const [i, e] of (timeline.data ?? []).entries()) {
    // "Ticket opened" repeats the message above it; a note is a message.
    // `?? ''` rather than a null check: this arrives over a
    // hand-written type, and on the admin side the same guard turned a
    // wrong field name into a blank page rather than a missing line.
    const said = (e.note ?? '').trim();
    if (said === '' || said === 'Ticket opened') continue;
    // WHO wrote it decides which side it sits on. A seller's own reply
    // rendered as ours would read as us answering ourselves.
    const mine = e.actorType === 'SELLER';
    bubbles.push({
      key: `note-${i}`,
      side: mine ? 'SELLER' : 'US',
      who: mine ? 'You' : 'Skydrop',
      body: said,
      at: e.at,
      ...(mine ? { relayedAt: e.relayedAt } : {}),
    });
  }

  for (const m of courier.data?.messages ?? []) {
    bubbles.push({
      key: `courier-${m.id}`,
      // Only what the courier SAID is theirs. Our outbound message to
      // them is still us talking.
      side: m.direction === 'INBOUND' ? 'COURIER' : 'US',
      who: m.direction === 'INBOUND' ? 'Courier' : 'Skydrop',
      body: m.body,
      at: m.occurredAt,
    });
  }

  // The closing note, when it is not already in the timeline.
  //
  // The call station writes the same sentence twice — once as a ticket
  // note, once as the resolution — so it would otherwise appear as two
  // identical bubbles a second apart. Deduped on the text rather than on
  // timestamps, which differ by exactly the round trip between them.
  const resolution = ticket.resolutionNotes?.trim() ?? '';
  if (resolution !== '' && ticket.resolvedAt !== null) {
    const alreadySaid = bubbles.some((b) => b.body.trim() === resolution);
    if (!alreadySaid) {
      bubbles.push({
        key: 'resolution',
        side: 'US',
        who: 'Skydrop',
        body: resolution,
        at: ticket.resolvedAt,
      });
    }
  }

  bubbles.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  if (timeline.isLoading || courier.isLoading) {
    return <SkeletonRows rows={3} cols={1} label="Loading the conversation…" />;
  }

  return (
    <>
      {/*
        An empty thread still gets the reply box below it. This used to
        RETURN here, before the box — so on an open ticket nobody had
        written on yet, the seller could read "Nothing said yet" and had
        no way to say anything themselves.
      */}
      {bubbles.length === 0 ? (
        <p className="tkt-empty-thread">
          Nothing said yet. We reply here once we have looked into it.
        </p>
      ) : null}
      <ol className="tkt-thread">
        {bubbles.map((b) => {
          const mine = b.side === 'SELLER';
          return (
            <li
              key={b.key}
              className={
                mine ? 'tkt-thread__row flex justify-end' : 'tkt-thread__row flex justify-start'
              }
              data-mine={mine ? '1' : undefined}
            >
              <div className="tkt-bubble" data-side={b.side}>
                <p className="tkt-bubble__who">
                  {b.who} ·{' '}
                  {new Date(b.at).toLocaleString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                <div className="tkt-bubble__text">{b.body}</div>
                {b.relayedAt === undefined ? null : (
                  <p className="mt-1 tkt-bubble__relay">
                    <MessageRelayStatus relayedAt={b.relayedAt} />
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {isOpen ? (
        <div className="tkt-reply">
          {/*
            ONE box, and it reaches US.

            There was a second one that wrote to the courier directly.
            It went, on a product call: we are the operational backbone,
            and the whole reason a seller in Dhaka does not need an
            Indian operation is that they never deal with Delhivery
            themselves. Two boxes made them pick a counterparty on every
            message, and the wrong pick is unrecoverable — a message
            sent to a courier cannot be taken back.

            The seller still SEES what the courier said: those messages
            are merged into the timeline above. What they no longer have
            is a way to write to them, which is ours to do.
          */}
          <TextArea
            label="Reply on this ticket"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Anything that helps — we take it to the courier for you."
            // Display only: the server's limit on a note (AddTicketNoteDto),
            // shown so a long reply is not a surprise, never enforced here.
            countMax={2000}
          />
          <div className="tkt-reply__actions">
            <PaperPlaneSendButton
              label="Send"
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
      ) : (
        <p className="tkt-closed">
          This ticket is closed. If something is still wrong, raise a new issue and we will pick it
          up.
        </p>
      )}
    </>
  );
}
