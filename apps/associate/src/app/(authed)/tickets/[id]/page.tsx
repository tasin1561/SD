'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';
import { ArrowLeft, OctagonX, Send } from 'lucide-react';
import { ActorType } from '@skydrop/db';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';
import { ticketStatusKind, ticketStatusLabel } from '@skydrop/ui/status';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TextArea } from '@skydrop/ui/app/text-field';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';
import { verdict } from '@/i18n/verdict';
import { useMyTicket, useMyTicketEvents, useReplyToTicket } from '@/lib/ticket-hooks';
import { BackLink, Facts, Notice, Section } from '../../_components/parts';
import '../../_components/as.css';

/**
 * Whose words are these?
 *
 * `STORE` is this side of the conversation; everybody else is the other
 * side, named by what they are rather than by the enum. The side decides
 * which way the bubble sits, so a thread reads as a conversation rather
 * than as a log.
 */
function speaker(
  actorType: ActorType,
  tr: Translate<MessageKey>,
): { readonly mine: boolean; readonly who: string } {
  switch (actorType) {
    case ActorType.STORE:
      return { mine: true, who: tr('ticket.speaker.store') };
    case ActorType.SELLER:
      return { mine: false, who: tr('ticket.speaker.seller') };
    case ActorType.SYSTEM:
      return { mine: false, who: tr('ticket.speaker.system') };
    default:
      return { mine: false, who: tr('ticket.speaker.skydrop') };
  }
}

/** One issue, its thread, and the reply box. */
export default function TicketDetailPage(): ReactElement {
  // `tr`, not `t`: this page's ticket row is already `t`.
  const tr = useT();
  const locale = useLocale();
  const when = (iso: string): string => formatDateTime(iso, locale);
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
        <PageHeader title={tr('ticket.issue')} />
        <SkeletonRows rows={4} cols={1} label={tr('ticket.loading')} />
      </div>
    );
  }
  if (ticket.isError) {
    return (
      <div className="as-page">
        <PageHeader title={tr('ticket.issue')} />
        <ErrorState message={verdict(ticket.error, tr)} retry={() => void ticket.refetch()} />
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
      setError(verdict(err, tr));
    }
  }

  return (
    <div className="as-page" data-width="narrow">
      <BackLink href="/tickets" icon={<ArrowLeft size={14} aria-hidden />}>
        {tr('tickets.title')}
      </BackLink>
      <PageHeader title={t.subject} subtitle={tr('ticket.raised', { when: when(t.createdAt) })} />

      <div className="as-row">
        <StatusChip kind={ticketStatusKind(t.status)} label={ticketStatusLabel(t.status, locale)} />
        <span className="as-muted sk-ident">{t.ticketNumber}</span>
      </div>

      <Section title={tr('ticket.aboutTitle')}>
        <Facts
          items={[
            {
              label: tr('ticket.order'),
              value:
                t.orderId === null ? (
                  (t.orderNumber ?? '—')
                ) : (
                  <Link href={`/orders/${t.orderId}`} className="as-link sk-ident">
                    {t.orderNumber ?? tr('ticket.openOrder')}
                  </Link>
                ),
            },
            { label: tr('ticket.raisedLabel'), value: when(t.createdAt) },
            {
              label: tr('ticket.closedLabel'),
              value: t.resolvedAt === null ? tr('ticket.notYet') : when(t.resolvedAt),
            },
          ]}
        />
        {t.resolutionNotes !== null && t.resolutionNotes !== '' ? (
          <Notice tone="good" title={tr('ticket.settled')}>
            <span>{t.resolutionNotes}</span>
          </Notice>
        ) : null}
      </Section>

      <Section title={tr('ticket.conversation')} bare>
        <div className="as-card">
          {events.isPending ? (
            <SkeletonRows rows={3} cols={1} label={tr('ticket.conversationLoading')} />
          ) : events.isError ? (
            <ErrorState message={verdict(events.error, tr)} retry={() => void events.refetch()} />
          ) : (
            <ul className="as-thread">
              {/* The opening message is the issue's own description; the
                  thread's own rows are everything said after it. */}
              {t.description !== null && t.description !== '' ? (
                <li className="as-msg" data-mine="1">
                  <span className="as-msg__who">
                    {tr('ticket.you', { when: when(t.createdAt) })}
                  </span>
                  <p className="as-msg__body">{t.description}</p>
                </li>
              ) : null}
              {events.data
                .filter((e) => e.note !== null && e.note !== '')
                .map((e) => {
                  const s = speaker(e.actorType, tr);
                  return (
                    <li key={e.id} className="as-msg" data-mine={s.mine ? '1' : undefined}>
                      <span className="as-msg__who">
                        {tr('ticket.speaker.line', { who: s.who, when: when(e.at) })}
                      </span>
                      <p className="as-msg__body">{e.note}</p>
                    </li>
                  );
                })}
            </ul>
          )}

          {closed ? (
            <p className="as-p" style={{ marginTop: 'var(--sp-4)' }}>
              {tr('ticket.closedNote')}
            </p>
          ) : (
            <form onSubmit={(e) => void send(e)} className="as-stack as-stack--tight">
              <TextArea
                label={tr('ticket.add')}
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
                  labels={{
                    idle: tr('ticket.send'),
                    busy: tr('ticket.sending'),
                    error: tr('ticket.notSent'),
                  }}
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
