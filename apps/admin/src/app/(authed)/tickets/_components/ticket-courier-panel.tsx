'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  ErrorNote,
  FormField,
  Input,
  SkeletonRows,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import {
  useCourierThread,
  useCourierThreadForTicket,
  useMarkOutboxSent,
  useOpenCourierEscalation,
  useCourierOutbox,
  useRecordCourierReply,
  useReplyToCourierAsStaff,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';

/**
 * The Delhivery conversation for this ticket, on the ticket.
 *
 * Ops works the ticket queue. Reaching the courier only from the
 * threads list meant a ticket nobody had already opened a thread on —
 * every seller-raised issue — had no route to the courier at all, and
 * their reply had nowhere to go.
 *
 * Two directions, and the INBOUND one is the load-bearing half: we send
 * to Delhivery by hand through their portal, so their answer only
 * reaches the seller if somebody types it back in here.
 */
export function TicketCourierPanel({ ticketId }: { readonly ticketId: string }): ReactElement {
  const toast = useToast();
  // FE-2: cosmetic. The server enforces this regardless.
  const canWrite = usePermission('courier.ops.write');
  // NOT cosmetic — this one gates the QUERIES. The ticket page is open
  // to `tickets.view`, which is a wider audience than the courier
  // surface: without this, opening any ticket fires two requests the
  // viewer may not make and they collect a 403 for doing nothing.
  const canSeeCourier = usePermission('courier.ops.view');

  const link = useCourierThreadForTicket(canSeeCourier ? ticketId : null);
  const escalationId = link.data?.id ?? null;
  const thread = useCourierThread(canSeeCourier ? escalationId : null);

  const open = useOpenCourierEscalation();
  const reply = useReplyToCourierAsStaff();
  const record = useRecordCourierReply();

  const [outbound, setOutbound] = useState('');
  const [inbound, setInbound] = useState('');
  // Delhivery's own ticket number, captured when the message is marked
  // sent. It is what binds their later replies to this escalation, so
  // it is asked for at the one moment the operator is looking at it.
  const [theirTicketId, setTheirTicketId] = useState('');

  const queue = useCourierOutbox();
  const markSent = useMarkOutboxSent();
  const waiting = (queue.data ?? []).filter(
    (i) => i.escalationId === escalationId && (i.status === 'PENDING' || i.status === 'SENDING'),
  );

  // After every hook, never before: an early return above a useState
  // changes the hook order between renders.
  if (!canSeeCourier) {
    return (
      <p className="text-text-muted text-sm">
        Courier conversations are handled by the courier-ops team.
      </p>
    );
  }

  if (link.isLoading) return <SkeletonRows rows={2} cols={1} />;
  if (link.isError) {
    return <ErrorNote message={serverVerdict(link.error)} retry={() => void link.refetch()} />;
  }

  if (escalationId === null) {
    return (
      <div className="border-border rounded-lg border p-3">
        <p className="text-text-body text-sm">No courier conversation on this ticket yet.</p>
        <p className="text-text-muted mt-1 text-xs">
          Start one when this needs taking up with the courier. Nothing is sent by opening it — a
          message you write is queued for someone to send from the courier’s own portal.
        </p>
        {canWrite ? (
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            disabled={open.isPending}
            onClick={() => {
              void (async () => {
                try {
                  await open.mutateAsync({ ticketId });
                  toast.success('Courier conversation started');
                } catch (err) {
                  toast.error(serverVerdict(err));
                }
              })();
            }}
          >
            {open.isPending ? 'Starting…' : 'Start a courier conversation'}
          </Button>
        ) : null}
      </div>
    );
  }

  const messages = thread.data?.messages ?? [];

  const send = (): void => {
    const body = outbound.trim();
    if (body === '') return;
    void (async () => {
      try {
        await reply.mutateAsync({ escalationId, body });
        setOutbound('');
        // Queued, not sent. Saying "sent" is a lie the operator finds
        // out about at the next reconciliation.
        toast.success('Queued in the send queue');
      } catch (err) {
        toast.error(serverVerdict(err));
      }
    })();
  };

  const saveReply = (): void => {
    const body = inbound.trim();
    if (body === '') return;
    void (async () => {
      try {
        await record.mutateAsync({ escalationId, body });
        setInbound('');
        toast.success('Recorded — the seller can see it now');
      } catch (err) {
        toast.error(serverVerdict(err));
      }
    })();
  };

  return (
    <div className="border-border space-y-3 rounded-lg border p-3">
      {thread.isLoading ? (
        <SkeletonRows rows={2} cols={1} />
      ) : messages.length === 0 ? (
        <p className="text-text-muted text-xs">Nothing said either way yet.</p>
      ) : (
        <ul className="space-y-2">
          {messages.map((m) => {
            const fromCourier = m.direction === 'INBOUND';
            return (
              <li
                key={m.id}
                className={
                  fromCourier
                    ? 'border-accent bg-accent/5 rounded border-l-2 py-1.5 pl-2.5 text-sm'
                    : 'border-border rounded border-l-2 py-1.5 pl-2.5 text-sm'
                }
              >
                <p className="text-text-muted text-xs">
                  {fromCourier ? 'Courier' : 'Us'} ·{' '}
                  {new Date(m.occurredAt).toLocaleString('en-IN')}
                </p>
                <p className="text-text-body whitespace-pre-wrap">{m.body}</p>
              </li>
            );
          })}
        </ul>
      )}

      {/*
        Everything written here is QUEUED, not sent — we have no API to
        Delhivery for support, so a person sends it from their portal and
        says so here. Until that happens the seller's question is sitting
        in a list, and nothing else on the screen would say so.
      */}
      {waiting.length > 0 ? (
        <div className="border-warning/40 bg-warning/5 space-y-2 rounded border p-2.5">
          <p className="text-text-bright text-xs font-semibold">
            {waiting.length === 1 ? 'One message' : `${waiting.length} messages`} waiting to be sent
            to the courier
          </p>
          {waiting.map((i) => (
            <div key={i.id} className="border-border rounded border p-2">
              <p className="text-text-body text-sm whitespace-pre-wrap">{i.body}</p>
              {canWrite ? (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <FormField
                    label="Their ticket number"
                    htmlFor={`ext-${i.id}`}
                    hint="Optional, but it is what binds their replies to this conversation."
                  >
                    <Input
                      id={`ext-${i.id}`}
                      value={theirTicketId}
                      onChange={(e) => setTheirTicketId(e.target.value)}
                      placeholder="e.g. 1234567"
                    />
                  </FormField>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={markSent.isPending}
                    onClick={() => {
                      void (async () => {
                        try {
                          await markSent.mutateAsync({
                            itemId: i.id,
                            ...(theirTicketId.trim() === ''
                              ? {}
                              : { externalTicketId: theirTicketId.trim() }),
                          });
                          setTheirTicketId('');
                          toast.success('Marked as sent to the courier');
                        } catch (err) {
                          toast.error(serverVerdict(err));
                        }
                      })();
                    }}
                  >
                    {markSent.isPending ? 'Saving…' : 'I have sent this'}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {canWrite ? (
        <>
          {/*
            The load-bearing half. We send to Delhivery by hand in their
            own portal, so their answer only reaches the seller if
            somebody types it back in here.
          */}
          <FormField
            label="What the courier told us"
            htmlFor={`inbound-${ticketId}`}
            hint="Paste their reply rather than paraphrasing — the seller reads this as the courier’s own words."
          >
            <Textarea
              id={`inbound-${ticketId}`}
              rows={3}
              value={inbound}
              onChange={(e) => setInbound(e.target.value)}
            />
          </FormField>
          <Button
            variant="primary"
            size="sm"
            disabled={inbound.trim() === '' || record.isPending}
            onClick={saveReply}
          >
            {record.isPending ? 'Saving…' : 'Save their reply'}
          </Button>

          <FormField
            label="Ask the courier something"
            htmlFor={`outbound-${ticketId}`}
            hint="Queued for someone to send from the courier’s portal. Stored and sent exactly as typed."
          >
            <Textarea
              id={`outbound-${ticketId}`}
              rows={2}
              value={outbound}
              onChange={(e) => setOutbound(e.target.value)}
            />
          </FormField>
          <Button
            variant="secondary"
            size="sm"
            disabled={outbound.trim() === '' || reply.isPending}
            onClick={send}
          >
            {reply.isPending ? 'Queueing…' : 'Queue for sending'}
          </Button>
        </>
      ) : null}
    </div>
  );
}
