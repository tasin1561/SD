'use client';

import type { ReactElement } from 'react';
import { useState } from 'react';
import { Button, SkeletonRows, Textarea, useToast } from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useCourierThreadForTicket,
  useReplyOnTicket,
  useTicketTimeline,
  type TicketView,
} from '@/lib/ops-hooks';

type Side = 'SELLER' | 'US' | 'COURIER';

interface Bubble {
  readonly key: string;
  readonly side: Side;
  readonly who: string;
  readonly body: string;
  readonly at: string;
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

  const send = (): void => {
    const note = draft.trim();
    if (note === '') return;
    void (async () => {
      try {
        await reply.mutateAsync({ ticketId: ticket.id, note });
        setDraft('');
      } catch (err) {
        toast.error(serverVerdict(err));
      }
    })();
  };

  const bubbles: Bubble[] = [];

  // The seller's opening message: what they raised, in their words.
  if (ticket.description !== null && ticket.description.trim() !== '') {
    bubbles.push({
      key: 'raised',
      side: 'SELLER',
      who: 'You',
      body: ticket.description,
      at: ticket.createdAt,
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

  if (timeline.isLoading || courier.isLoading) return <SkeletonRows rows={3} cols={1} />;

  if (bubbles.length === 0) {
    return (
      <p className="text-text-muted text-sm">
        Nothing said yet. We reply here once we have looked into it.
      </p>
    );
  }

  return (
    <>
      <ol className="space-y-3">
        {bubbles.map((b) => {
          const mine = b.side === 'SELLER';
          return (
            <li key={b.key} className={mine ? 'flex justify-end' : 'flex justify-start'}>
              <div className="max-w-[85%]">
                <p className={`text-text-muted mb-1 text-xs ${mine ? 'text-right' : 'text-left'}`}>
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
                    mine
                      ? 'bg-accent/10 border-accent/30 rounded-lg rounded-tr-sm border px-3 py-2 text-sm whitespace-pre-wrap'
                      : b.side === 'COURIER'
                        ? 'bg-warning/10 border-warning/30 rounded-lg rounded-tl-sm border px-3 py-2 text-sm whitespace-pre-wrap'
                        : 'bg-surface-raised border-border rounded-lg rounded-tl-sm border px-3 py-2 text-sm whitespace-pre-wrap'
                  }
                >
                  {b.body}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {isOpen ? (
        <div className="border-border mt-4 border-t pt-3">
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
          <Textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Anything that helps — we take it to the courier for you."
            aria-label="Reply on this ticket"
          />
          <div className="mt-2 flex justify-end">
            <Button
              variant="primary"
              size="sm"
              disabled={draft.trim() === '' || reply.isPending}
              onClick={send}
            >
              {reply.isPending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-text-muted border-border mt-4 border-t pt-3 text-xs">
          This ticket is closed. If something is still wrong, raise a new issue and we will pick it
          up.
        </p>
      )}
    </>
  );
}
