'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';
import { ArrowLeft, OctagonX, Send } from 'lucide-react';
import { ActorType } from '@skydrop/db';
import { ticketStatusKind, ticketStatusLabel } from '@skydrop/ui/status';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TextArea } from '@skydrop/ui/app/text-field';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { serverVerdict } from '@/lib/server-verdict';
import { useMyTicket, useMyTicketEvents, useReplyToTicket } from '@/lib/ticket-hooks';
import { BackLink, Facts, Notice, Section } from '../../_components/parts';
import '../../_components/as.css';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Whose words are these?
 *
 * `STORE` is this side of the conversation; everybody else is the other
 * side, named by what they are rather than by the enum. The side decides
 * which way the bubble sits, so a thread reads as a conversation rather
 * than as a log.
 */
function speaker(actorType: ActorType): { readonly mine: boolean; readonly who: string } {
  switch (actorType) {
    case ActorType.STORE:
      return { mine: true, who: 'You or your store' };
    case ActorType.SELLER:
      return { mine: false, who: 'Your store’s supplier' };
    case ActorType.SYSTEM:
      return { mine: false, who: 'Skydrop (automatic)' };
    default:
      return { mine: false, who: 'Skydrop' };
  }
}

/** One issue, its thread, and the reply box. */
export default function TicketDetailPage(): ReactElement {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const ticket = useMyTicket(id);
  const events = useMyTicketEvents(id);
  const reply = useReplyToTicket(id);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (ticket.isPending) {
    return (
      <div className="as-page">
        <PageHeader title="Issue" />
        <SkeletonRows rows={4} cols={1} label="Loading the issue" />
      </div>
    );
  }
  if (ticket.isError) {
    return (
      <div className="as-page">
        <PageHeader title="Issue" />
        <ErrorState message={serverVerdict(ticket.error)} retry={() => void ticket.refetch()} />
      </div>
    );
  }

  const t = ticket.data;
  const closed = t.resolvedAt !== null;

  async function send(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      await reply.mutateAsync({ note: note.trim() });
      setNote('');
      void events.refetch();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <div className="as-page" data-width="narrow">
      <BackLink href="/tickets" icon={<ArrowLeft size={14} aria-hidden />}>
        Issues
      </BackLink>
      <PageHeader title={t.subject} subtitle={`Raised ${when(t.createdAt)}`} />

      <div className="as-row">
        <StatusChip kind={ticketStatusKind(t.status)} label={ticketStatusLabel(t.status)} />
        <span className="as-muted sk-ident">{t.ticketNumber}</span>
      </div>

      <Section title="What it is about">
        <Facts
          items={[
            {
              label: 'Order',
              value:
                t.orderId === null ? (
                  (t.orderNumber ?? '—')
                ) : (
                  <Link href={`/orders/${t.orderId}`} className="as-link sk-ident">
                    {t.orderNumber ?? 'Open the order'}
                  </Link>
                ),
            },
            { label: 'Raised', value: when(t.createdAt) },
            { label: 'Closed', value: t.resolvedAt === null ? 'Not yet' : when(t.resolvedAt) },
          ]}
        />
        {t.resolutionNotes !== null && t.resolutionNotes !== '' ? (
          <Notice tone="good" title="How it was settled">
            <span>{t.resolutionNotes}</span>
          </Notice>
        ) : null}
      </Section>

      <Section title="The conversation" bare>
        <div className="as-card">
          {events.isPending ? (
            <SkeletonRows rows={3} cols={1} label="Loading the conversation" />
          ) : events.isError ? (
            <ErrorState message={serverVerdict(events.error)} retry={() => void events.refetch()} />
          ) : (
            <ul className="as-thread">
              {/* The opening message is the issue's own description; the
                  thread's own rows are everything said after it. */}
              {t.description !== null && t.description !== '' ? (
                <li className="as-msg" data-mine="1">
                  <span className="as-msg__who">You · {when(t.createdAt)}</span>
                  <p className="as-msg__body">{t.description}</p>
                </li>
              ) : null}
              {events.data
                .filter((e) => e.note !== null && e.note !== '')
                .map((e) => {
                  const s = speaker(e.actorType);
                  return (
                    <li key={e.id} className="as-msg" data-mine={s.mine ? '1' : undefined}>
                      <span className="as-msg__who">
                        {s.who} · {when(e.at)}
                      </span>
                      <p className="as-msg__body">{e.note}</p>
                    </li>
                  );
                })}
            </ul>
          )}

          {closed ? (
            <p className="as-p" style={{ marginTop: 'var(--sp-4)' }}>
              This one is closed. Raise a new issue if something else has gone wrong.
            </p>
          ) : (
            <form onSubmit={(e) => void send(e)} className="as-stack as-stack--tight">
              <TextArea
                label="Add something"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
                showCount
              />
              {error !== null ? (
                <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
                  <p className="as-error">{error}</p>
                </Notice>
              ) : null}
              <div className="as-row">
                <AsyncButton
                  type="submit"
                  variant="primary"
                  icon={<Send size={15} />}
                  labels={{ idle: 'Send', busy: 'Sending…', error: 'Not sent' }}
                  state={reply.isPending ? 'busy' : error !== null ? 'error' : 'idle'}
                  disabled={reply.isPending || note.trim() === ''}
                />
              </div>
            </form>
          )}
        </div>
      </Section>
    </div>
  );
}
