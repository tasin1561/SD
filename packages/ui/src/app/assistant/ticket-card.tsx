'use client';

import { Check, LifeBuoy, Loader2 } from 'lucide-react';
import { useRef, useState, type MouseEvent, type ReactElement } from 'react';
import type { Translate } from '../i18n';
import type { UiMessageKey } from '../i18n/ui-messages';
import { describeUploadError } from './attachments';

/** A ticket the assistant PROPOSED. Mirrors `ProposalView` in the API; nothing exists until the person presses the button. */
export interface TicketProposal {
  readonly id: string;
  readonly subject: string;
  readonly description: string;
  readonly orderNumber: string | null;
  readonly status: 'PENDING' | 'CONFIRMED' | 'DISMISSED';
  readonly ticketId?: string | null;
  readonly ticketNumber?: string | null;
  /** A member store's issue waiting for the client to approve it. */
  readonly held?: boolean;
}

export interface TicketCardTransport {
  request<T>(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<T>;
}

/** Narrow an SSE `ticket_proposal` payload, or a stored proposal, to the card's shape. */
export function toTicketProposal(value: unknown): TicketProposal | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v['id'] !== 'string' || typeof v['subject'] !== 'string') return null;
  if (typeof v['description'] !== 'string') return null;
  const status = v['status'];
  return {
    id: v['id'],
    subject: v['subject'],
    description: v['description'],
    orderNumber: typeof v['orderNumber'] === 'string' ? v['orderNumber'] : null,
    status: status === 'CONFIRMED' || status === 'DISMISSED' ? status : 'PENDING',
    ticketId: typeof v['ticketId'] === 'string' ? v['ticketId'] : null,
    ticketNumber: typeof v['ticketNumber'] === 'string' ? v['ticketNumber'] : null,
    held: v['held'] === true,
  };
}

/**
 * The card under the assistant's message. The assistant only ever PROPOSES;
 * the ticket is raised by the person pressing "Raise this ticket", through
 * the server (which re-checks who they are and what they may do). The
 * button carries its own idle / busy / done / error states, so there is
 * nothing to hunt for on a phone: 44px targets, one primary action, and
 * the server's own `[CODE] message` when it refuses (FE-2).
 */
export function TicketProposalCard({
  proposal,
  base,
  transport,
  t,
  onNavigate,
}: {
  readonly proposal: TicketProposal;
  /** `/seller/assistant` or `/store/assistant`. */
  readonly base: string;
  readonly transport: TicketCardTransport;
  readonly t: Translate<UiMessageKey>;
  /** Client-side navigation to `/tickets/<id>`; absent = a plain link. */
  readonly onNavigate?: ((href: string) => void) | undefined;
}): ReactElement {
  const [view, setView] = useState<TicketProposal>(proposal);
  const [phase, setPhase] = useState<'idle' | 'busy' | 'error'>('idle');
  const [error, setError] = useState('');
  // A ref, not state: two clicks in the same tick must not both reach the server.
  const inFlight = useRef(false);

  const act = async (verb: 'confirm' | 'dismiss'): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase('busy');
    setError('');
    try {
      const next = await transport.request<unknown>(`${base}/ticket-proposals/${view.id}/${verb}`, {
        method: 'POST',
        body: {},
      });
      const parsed = toTicketProposal(next);
      if (parsed !== null) setView(parsed);
      setPhase('idle');
    } catch (e) {
      setError(describeUploadError(e, t('ui.assistant.ticket.failed')));
      setPhase('error');
    } finally {
      inFlight.current = false;
    }
  };

  const busy = phase === 'busy';
  const href = view.ticketId ? `/tickets/${view.ticketId}` : null;
  const open = (e: MouseEvent<HTMLAnchorElement>): void => {
    if (!onNavigate || href === null || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) {
      return;
    }
    e.preventDefault();
    onNavigate(href);
  };

  return (
    <section
      className="sk-ai-ticket"
      data-status={view.status}
      aria-label={t('ui.assistant.ticket.suggested')}
    >
      <header className="sk-ai-ticket__head">
        <LifeBuoy size={16} aria-hidden="true" />
        <span>{t('ui.assistant.ticket.suggested')}</span>
        {view.orderNumber !== null ? (
          <span className="sk-ai-ticket__order">
            {t('ui.assistant.ticket.order', { n: view.orderNumber })}
          </span>
        ) : null}
      </header>
      <h4 className="sk-ai-ticket__subject">{view.subject}</h4>
      <p className="sk-ai-ticket__body">{view.description}</p>

      {view.status === 'PENDING' ? (
        <div className="sk-ai-ticket__actions">
          <button
            type="button"
            className="sk-ai-ticket__primary"
            data-state={phase}
            disabled={busy}
            aria-busy={busy}
            onClick={() => void act('confirm')}
          >
            {busy ? (
              <>
                <Loader2 size={16} aria-hidden="true" className="sk-ai-ticket__spin" />
                <span>{t('ui.assistant.ticket.raising')}</span>
              </>
            ) : (
              <span>{phase === 'error' ? t('ui.retry') : t('ui.assistant.ticket.raise')}</span>
            )}
          </button>
          <button
            type="button"
            className="sk-ai-ticket__quiet"
            disabled={busy}
            onClick={() => void act('dismiss')}
          >
            {t('ui.assistant.ticket.notNow')}
          </button>
        </div>
      ) : view.status === 'CONFIRMED' ? (
        <p className="sk-ai-ticket__done" role="status">
          <Check size={16} aria-hidden="true" />
          {view.held === true ? (
            <span>{t('ui.assistant.ticket.held')}</span>
          ) : (
            <>
              <span>{t('ui.assistant.ticket.raised')}</span>
              {view.ticketNumber ? <span aria-hidden="true"> · </span> : null}
              {href !== null && view.ticketNumber ? (
                <a
                  href={href}
                  onClick={open}
                  aria-label={`${t('ui.assistant.ticket.view')} ${view.ticketNumber}`}
                >
                  {view.ticketNumber}
                </a>
              ) : null}
            </>
          )}
        </p>
      ) : (
        <p className="sk-ai-ticket__done" data-muted="1" role="status">
          {t('ui.assistant.ticket.dismissed')}
        </p>
      )}

      {phase === 'error' ? (
        <p className="sk-ai-ticket__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
