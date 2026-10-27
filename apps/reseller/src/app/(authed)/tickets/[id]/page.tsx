'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import { Send } from 'lucide-react';
import type { ActorType } from '@skydrop/db';
import { useStoreIdentity } from '@skydrop/auth/client';
import { Money } from '@skydrop/ui/components';
import { ticketStatusKind, ticketStatusLabel } from '@skydrop/ui/status';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { PaperPlaneSendButton } from '@skydrop/ui/app/paper-plane-send';
import { TextArea } from '@skydrop/ui/app/text-field';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { can } from '@/lib/page-access';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';
import { richMessage, useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';
import { verdict } from '@/i18n/verdict';
import { storeTicketKind } from '@/lib/ticket-kind';
import {
  useReplyStoreTicket,
  useStoreTicket,
  useStoreTicketEvents,
  type StoreTicketView,
} from '@/lib/ticket-hooks';
import '../_components/tickets.css';

function who(actor: ActorType, tr: Translate<MessageKey>): string {
  switch (actor) {
    case 'STORE':
      return tr('tkt.d.who.you');
    case 'SELLER':
    case 'API':
      return tr('tkt.d.who.client');
    default:
      return tr('tkt.d.who.skydrop');
  }
}

/** RS-7 — one of this store's disputes: what was said, and how it ended. */
export default function TicketPage(): ReactElement {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const ticket = useStoreTicket(id);
  const tr = useT();
  const crumbs = [{ label: tr('tkt.d.crumb'), href: '/tickets' }, { label: tr('tkt.d.ticket') }];
  return (
    <div className="rc-tkt-page">
      {ticket.isPending ? (
        <>
          <PageHeader breadcrumbs={crumbs} Link={Link} title={tr('tkt.d.ticket')} />
          <SkeletonRows rows={4} cols={2} label={tr('tkt.d.loading')} />
        </>
      ) : ticket.isError ? (
        <>
          <PageHeader breadcrumbs={crumbs} Link={Link} title={tr('tkt.d.ticket')} />
          <ErrorState message={verdict(ticket.error, tr)} retry={() => void ticket.refetch()} />
        </>
      ) : (
        <TicketBody t={ticket.data} />
      )}
    </div>
  );
}

function Outcome({ t }: { t: StoreTicketView }): ReactElement | null {
  const tr = useT();
  const locale = useLocale();
  if (t.resolvedAt === null) return null;
  const amount = t.resolutionAmountInr;
  const settled = (t.disputePayer === 'STORE' || t.disputePayer === 'SELLER') && amount !== null;
  return (
    <div className="rc-tkt-card" data-tone={settled ? 'settled' : undefined}>
      <p>
        {t.disputePayer === 'STORE' && amount !== null ? (
          <>
            {richMessage(tr('tkt.d.settled.store'), {
              amount: <Money amount={amount} convert={false} />,
            })}
          </>
        ) : t.disputePayer === 'SELLER' && amount !== null ? (
          <>
            {richMessage(tr('tkt.d.settled.seller'), {
              amount: <Money amount={amount} convert={false} />,
            })}
          </>
        ) : (
          <>{tr('tkt.d.closed', { when: formatDateTime(t.resolvedAt, locale) })}</>
        )}
      </p>
      {t.resolutionNotes !== null ? (
        <p className="rc-tkt-card__note">{tr('tkt.d.note', { note: t.resolutionNotes })}</p>
      ) : null}
    </div>
  );
}

/**
 * RS-7 (2026-09-19) — a "correct the figures" dispute: what is being
 * claimed, and the money AS IT STOOD when it was raised.
 *
 * The snapshot is shown rather than a live read on purpose. The ledger
 * keeps moving — a later payout, a courier cost, a refund — so "the
 * figures we were arguing about" and "the figures now" are different
 * questions, and only the first one explains what was asked for.
 */
function Correction({ t }: { t: StoreTicketView }): ReactElement | null {
  const tr = useT();
  const locale = useLocale();
  if (t.disputeKind !== 'FIGURE_CORRECTION') return null;
  /*
    ASSOC-1 — an associate is not a party to what the store and the
    seller settle between them, so the server withholds the whole block
    and the panel says so rather than rendering an empty card. The claim
    itself stays: it is what the ticket is ABOUT, and the conversation
    below would otherwise make no sense.
  */
  if (!t.figures.visible) {
    return (
      <section className="rc-tkt-section">
        <SectionHeading title={tr('tkt.d.figures')} note={tr('tkt.d.figures.hidden')} />
        <div className="rc-tkt-card">
          {t.disputeClaimAmountInr !== null ? (
            <p>
              {richMessage(tr('tkt.d.claimed'), {
                amount: <Money amount={t.disputeClaimAmountInr} convert={false} />,
              })}
            </p>
          ) : null}
          {t.figures.codInr === null ? null : (
            <p className="rc-tkt-card__as-at">
              {richMessage(tr('tkt.d.customerPays'), {
                amount: <Money amount={t.figures.codInr} convert={false} />,
              })}
            </p>
          )}
        </div>
      </section>
    );
  }
  const f = t.figures.snapshot;
  return (
    <section className="rc-tkt-section">
      <SectionHeading title={tr('tkt.d.figures')} note={tr('tkt.d.figures.shown')} />
      <div className="rc-tkt-card">
        {t.disputeClaimAmountInr !== null ? (
          <p>
            {richMessage(tr('tkt.d.claimed'), {
              amount: <Money amount={t.disputeClaimAmountInr} convert={false} />,
            })}{' '}
            <span className="rc-tkt-card__aside">
              {t.disputeClaimPayer === 'STORE' ? tr('tkt.d.weOwe') : tr('tkt.d.theyOwe')}
            </span>
          </p>
        ) : null}
        {f === null ? (
          <p className="rc-tkt-card__note">{tr('tkt.d.noFigures')}</p>
        ) : (
          <>
            <p className="rc-tkt-card__as-at">
              {richMessage(
                tr('tkt.d.asAt', {
                  when: formatDateTime(f.capturedAt, locale),
                  mode: f.paymentMode,
                }),
                { order: <span className="sk-ident">{f.orderNumber}</span> },
              )}
              {f.codInr === null
                ? null
                : richMessage(tr('tkt.d.cod'), {
                    amount: <Money amount={f.codInr} convert={false} />,
                  })}
            </p>
            {f.parties.map((p) => (
              <p key={p.party}>
                {richMessage(
                  tr('tkt.d.partyNet', {
                    party: p.party === 'STORE' ? tr('tkt.d.party.us') : tr('tkt.d.party.client'),
                  }),
                  { amount: <Money amount={p.netInr} convert={false} /> },
                )}{' '}
                <span className="rc-tkt-card__aside">({p.status.toLowerCase()})</span>
              </p>
            ))}
          </>
        )}
      </div>
    </section>
  );
}

function TicketBody({ t }: { t: StoreTicketView }): ReactElement {
  const tr = useT();
  const locale = useLocale();
  const me = useStoreIdentity();
  const events = useStoreTicketEvents(t.id);
  const reply = useReplyStoreTicket(t.id);
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const open = t.resolvedAt === null;

  /**
   * The real request. It rejects after showing the server's verdict, so
   * the send button shows the failure it really had and the paper plane
   * flies only after a real success.
   */
  async function send(): Promise<void> {
    setError(null);
    try {
      await reply.mutateAsync({ note });
      setNote('');
      toast.success(tr('tkt.d.replySent'));
    } catch (err) {
      setError(verdict(err, tr));
      throw err;
    }
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: tr('tkt.d.crumb'), href: '/tickets' }, { label: t.ticketNumber }]}
        Link={Link}
        title={t.subject}
        subtitle={
          <span className="rc-tkt-sub">
            <span className="sk-ident">{t.ticketNumber}</span>
            {t.orderId !== null
              ? richMessage(tr('tkt.d.sub.order'), {
                  order: (
                    <Link href={`/orders/${t.orderId}`} className="sk-ident">
                      {t.orderNumber ?? t.orderId}
                    </Link>
                  ),
                })
              : null}
            {tr('tkt.d.sub.opened', { when: formatDateTime(t.createdAt, locale) })}
            {/* WHO is on the other end. Said on the thread itself and not
                only in the list: somebody arriving from a link has not
                seen the list, and what they write next depends on it. */}
            {tr('tkt.d.sub.with', { who: storeTicketKind(t.ticketType, tr).counterparty })}
          </span>
        }
        action={
          <StatusChip
            kind={ticketStatusKind(t.status)}
            label={ticketStatusLabel(t.status, locale)}
          />
        }
      />
      <Outcome t={t} />
      <Correction t={t} />
      <section className="rc-tkt-section">
        <SectionHeading title={tr('tkt.d.conversation')} />
        {t.description !== null ? <p className="rc-tkt-opening">{t.description}</p> : null}
        {events.isPending ? (
          <SkeletonRows rows={3} cols={1} label={tr('tkt.d.convLoading')} />
        ) : events.isError ? (
          <ErrorState message={verdict(events.error, tr)} retry={() => void events.refetch()} />
        ) : (
          <ol className="rc-tkt-thread">
            {events.data
              .filter((e) => e.note !== null && e.note !== 'Ticket opened')
              .map((e) => {
                const mine = e.actorType === 'STORE';
                return (
                  <li key={e.id} className="rc-tkt-thread__row" data-mine={mine ? '1' : undefined}>
                    <div className="rc-tkt-bubble">
                      <p className="rc-tkt-bubble__who">
                        {who(e.actorType, tr)} ·{' '}
                        <span className="sk-figure">{formatDateTime(e.at, locale)}</span>
                      </p>
                      <div className="rc-tkt-bubble__text">{e.note}</div>
                    </div>
                  </li>
                );
              })}
          </ol>
        )}
        {open && can(me, 'tickets.manage') ? (
          <div className="rc-tkt-reply">
            <TextArea
              label={tr('tkt.d.reply')}
              placeholder={tr('tkt.d.reply')}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={4000}
              // Display only: the server's limit on a note (AddTicketNoteDto,
              // 2000). The field's own 4000 cap is unchanged.
              countMax={2000}
            />
            {error !== null ? (
              <p role="alert" className="rc-tkt-error">
                {error}
              </p>
            ) : null}
            <div className="rc-tkt-reply__actions">
              <PaperPlaneSendButton
                label={tr('tkt.d.send')}
                busyLabel={tr('tkt.d.sending')}
                doneLabel={tr('tkt.d.sent')}
                errorLabel={tr('tkt.d.notSent')}
                size="sm"
                icon={<Send size={14} />}
                disabled={reply.isPending || note.trim() === ''}
                onAction={send}
              />
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
