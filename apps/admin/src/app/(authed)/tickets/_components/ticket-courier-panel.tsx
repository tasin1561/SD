'use client';

import { useState, type ReactElement } from 'react';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import '@/app/(authed)/system/_components/af.css';
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
import { useT } from '@/i18n/client';

/**
 * The courier conversation for this ticket, on the ticket — whichever
 * courier carried the parcel (Delhivery, Shiprocket), worked identically.
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
  const t = useT();
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
      <p className="af-muted">{t('ticketsTicketCourierPanel.courierConversationsAreHandledBy')}</p>
    );
  }

  if (link.isLoading)
    return (
      <SkeletonRows
        rows={2}
        cols={1}
        label={t('ticketsTicketCourierPanel.loadingTheCourierConversation')}
      />
    );
  if (link.isError) {
    return <ErrorState message={serverVerdict(link.error)} retry={() => void link.refetch()} />;
  }

  if (escalationId === null) {
    return (
      <div className="af-inner">
        <p className="af-body">{t('ticketsTicketCourierPanel.noCourierConversationOnThis')}</p>
        <p className="af-small">{t('ticketsTicketCourierPanel.startOneWhenThisNeeds')}</p>
        {canWrite ? (
          <div>
            <AsyncButton
              variant="secondary"
              size="sm"
              labels={{
                idle: t('ticketsTicketCourierPanel.startACourierConversation'),
                busy: t('ticketsTicketCourierPanel.starting'),
                done: t('ticketsTicketCourierPanel.started'),
                error: t('ticketsTicketCourierPanel.notStarted'),
              }}
              disabled={open.isPending}
              onAction={async () => {
                try {
                  await open.mutateAsync({ ticketId });
                  toast.success(t('ticketsTicketCourierPanel.courierConversationStarted'));
                } catch (err) {
                  toast.error(serverVerdict(err));
                  throw err;
                }
              }}
            />
          </div>
        ) : null}
      </div>
    );
  }

  const messages = thread.data?.messages ?? [];
  // WHICH courier's desk — the one that carried the parcel. Shown so
  // the operator raises it with the right company, by hand.
  const desk = thread.data?.desk ?? null;

  const send = (): void => {
    const body = outbound.trim();
    if (body === '') return;
    void (async () => {
      try {
        await reply.mutateAsync({ escalationId, body });
        setOutbound('');
        // Queued, not sent. Saying "sent" is a lie the operator finds
        // out about at the next reconciliation.
        toast.success(t('ticketsTicketCourierPanel.queuedInTheSendQueue'));
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
        toast.success(t('ticketsTicketCourierPanel.recordedTheClientCanSee'));
      } catch (err) {
        toast.error(serverVerdict(err));
      }
    })();
  };

  return (
    <div className="af-inner">
      {desk !== null ? (
        <div className="af-stack--tight af-stack">
          <p className="af-title">
            {t('ticketsTicketCourierPanel.support', {
              courierName: desk.courierName,
              value: desk.canSendAutomatically ? '' : ' — sent by hand',
            })}
          </p>
          <p className="af-small">{desk.howTo}</p>
          <p className="af-small">
            {desk.ticketUrl !== null || desk.panelUrl !== null ? (
              <a
                href={desk.ticketUrl ?? desk.panelUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="af-link"
              >
                {desk.ticketUrl !== null
                  ? t('ticketsTicketCourierPanel.openTheirTicket')
                  : t('ticketsTicketCourierPanel.open', { courierName: desk.courierName })}
              </a>
            ) : null}
            {' · '}
            {desk.supportEmail ??
              t('ticketsTicketCourierPanel.noSupportEmailSet', {
                supportEmailSettingKey: desk.supportEmailSettingKey,
              })}
          </p>
        </div>
      ) : null}
      {thread.isLoading ? (
        <SkeletonRows rows={2} cols={1} label={t('ticketsTicketCourierPanel.loadingMessages')} />
      ) : messages.length === 0 ? (
        <p className="af-small">{t('ticketsTicketCourierPanel.nothingSaidEitherWayYet')}</p>
      ) : (
        <ul className="af-list">
          {messages.map((m) => {
            const fromCourier = m.direction === 'INBOUND';
            return (
              <li key={m.id} className="af-stack--tight af-stack">
                <p className="af-small">
                  {fromCourier
                    ? t('ticketsTicketCourierPanel.courier')
                    : t('ticketsTicketCourierPanel.us')}{' '}
                  · {new Date(m.occurredAt).toLocaleString('en-IN')}
                </p>
                <p className="af-pre" data-dense="1" data-side={fromCourier ? 'in' : undefined}>
                  {m.body}
                </p>
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
        <div className="af-inner" data-tone="warn">
          <p className="af-title">
            {t('ticketsTicketCourierPanel.waitingToBeSentTo', {
              value:
                waiting.length === 1
                  ? t('ticketsTicketCourierPanel.oneMessage')
                  : `${waiting.length} messages`,
            })}
          </p>
          {waiting.map((i) => (
            <div key={i.id} className="af-stack">
              <p className="af-pre" data-dense="1">
                {i.body}
              </p>
              {canWrite ? (
                <div className="af-row af-row--bottom">
                  <div className="af-grow">
                    <TextField
                      id={`ext-${i.id}`}
                      label={t('ticketsTicketCourierPanel.theirTicketNumber')}
                      hint={t('ticketsTicketCourierPanel.optionalButItIsWhat')}
                      value={theirTicketId}
                      onChange={(e) => setTheirTicketId(e.target.value)}
                      placeholder="e.g. 1234567"
                    />
                  </div>
                  <AsyncButton
                    variant="primary"
                    size="sm"
                    labels={{
                      idle: t('ticketsTicketCourierPanel.iHaveSentThis'),
                      busy: t('ticketsTicketCourierPanel.saving'),
                      done: t('ticketsTicketCourierPanel.markedSent'),
                      error: t('ticketsTicketCourierPanel.notSaved'),
                    }}
                    disabled={markSent.isPending}
                    onAction={async () => {
                      try {
                        await markSent.mutateAsync({
                          itemId: i.id,
                          ...(theirTicketId.trim() === ''
                            ? {}
                            : { externalTicketId: theirTicketId.trim() }),
                        });
                        setTheirTicketId('');
                        toast.success(t('ticketsTicketCourierPanel.markedAsSentToThe'));
                      } catch (err) {
                        toast.error(serverVerdict(err));
                        throw err;
                      }
                    }}
                  />
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
          <TextArea
            id={`inbound-${ticketId}`}
            label={t('ticketsTicketCourierPanel.whatTheCourierToldUs')}
            hint={t('ticketsTicketCourierPanel.pasteTheirReplyRatherThan')}
            rows={3}
            value={inbound}
            onChange={(e) => setInbound(e.target.value)}
          />
          <div>
            <Button
              variant="primary"
              size="sm"
              disabled={inbound.trim() === '' || record.isPending}
              loading={record.isPending}
              onClick={saveReply}
            >
              {t('ticketsTicketCourierPanel.saveTheirReply')}
            </Button>
          </div>

          <TextArea
            id={`outbound-${ticketId}`}
            label={t('ticketsTicketCourierPanel.askTheCourierSomething')}
            hint={t('ticketsTicketCourierPanel.queuedForSomeoneToSend')}
            rows={2}
            value={outbound}
            onChange={(e) => setOutbound(e.target.value)}
          />
          <div>
            <Button
              variant="secondary"
              size="sm"
              disabled={outbound.trim() === '' || reply.isPending}
              loading={reply.isPending}
              onClick={send}
            >
              {t('ticketsTicketCourierPanel.queueForSending')}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
