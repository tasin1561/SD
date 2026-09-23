'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Ident, IssueCategoryLine, Money } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { useToast } from '@skydrop/ui/app/toast';
import { AfCard, AfSection, Facts } from '@/app/(authed)/system/_components/af-parts';
import { TicketStatusChip } from './ticket-chips';
import './tickets.css';
import { TicketStatus, TicketType } from '@skydrop/db';
import { useAdminTicket, useTicketEvents, useTransitionTicket } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { AdminTicketConversation } from './admin-ticket-conversation';
import { StoreDisputeSettle } from './store-dispute-settle';

/**
 * THREE stages, in the order a ticket actually travels: Open →
 * Reviewing → Closed.
 *
 * The dropdown used to list five, and it was really two questions
 * wearing one control: what STAGE is this at, and — if it is finishing
 * — HOW did it finish. Five flat options made those look like peers,
 * so "Refund the seller" sat next to "Under discussion" as if they were
 * the same kind of choice.
 *
 * They are not, and the difference is money: `RESOLVED_REFUND` writes a
 * SCRAP_REFUND credit to the seller's wallet inside the transition
 * transaction (TKT-1). Collapsing the outcomes into one "Closed" would
 * have meant either paying on EVERY close or never being able to pay at
 * all — so the four outcomes survive, asked at the step where they are
 * the actual question.
 */
const STAGES: ReadonlyArray<{ value: 'REVIEWING' | 'CLOSED'; label: string }> = [
  { value: 'REVIEWING', label: 'Reviewing' },
  { value: 'CLOSED', label: 'Closed' },
];

/** How a ticket finished. Asked only once "Closed" is chosen. */
const OUTCOMES: ReadonlyArray<{ value: TicketStatus; label: string }> = [
  { value: TicketStatus.RESOLVED_REFUND, label: 'Refunded the seller' },
  { value: TicketStatus.RESOLVED_RETURNED, label: 'Goods went back' },
  { value: TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED, label: 'Seller accepted the loss' },
  { value: TicketStatus.REJECTED, label: 'Not upheld' },
];

/**
 * One ticket, in full.
 *
 * The drawer stays for triage from the list — glance, move it on, close
 * it. But it was also the only place the courier conversation lived,
 * and a modal already busy with a status form is the wrong home for the
 * exchange this ticket exists to carry.
 */
export function AdminTicketDetail({ ticketId }: { readonly ticketId: string }): ReactElement {
  const toast = useToast();
  const ticket = useAdminTicket(ticketId);
  const events = useTicketEvents(ticketId);
  const transition = useTransitionTicket();
  // FE-2: cosmetic. The server refuses regardless.
  const canResolve = usePermission('tickets.resolve');

  const [stage, setStage] = useState<'' | 'REVIEWING' | 'CLOSED'>('');
  const [to, setTo] = useState<TicketStatus | ''>('');
  const [notes, setNotes] = useState('');
  const [refund, setRefund] = useState('');
  // A refund credits a seller's wallet in the same transaction, so Apply
  // asks first when that is the outcome chosen; the request is unchanged.
  const [confirmRefund, setConfirmRefund] = useState(false);

  if (ticket.isLoading) return <SkeletonRows rows={6} cols={1} label="Loading the ticket" />;
  if (ticket.isError) {
    return <ErrorState message={serverVerdict(ticket.error)} retry={() => void ticket.refetch()} />;
  }
  const t = ticket.data;
  if (t === undefined) return <div />;
  // RS-7 — a store dispute is settled BETWEEN the store and the seller,
  // never refunded by us. Cosmetic: the API refuses the refund outcome
  // on this type with STORE_DISPUTE_USE_SETTLEMENT regardless.
  const isStoreDispute = t.ticketType === TicketType.STORE_DISPUTE;
  const outcomes = isStoreDispute
    ? OUTCOMES.filter((o) => o.value !== TicketStatus.RESOLVED_REFUND)
    : OUTCOMES;

  /*
    The request itself. It resolves on success and rejects on a refusal
    (after toasting the server's verdict verbatim), so the Apply button's
    state and the refund confirm both follow the REAL outcome.
  */
  const send = async (): Promise<void> => {
    if (to === '') return;
    try {
      await transition.mutateAsync({
        ticketId,
        to,
        ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
        ...(to === TicketStatus.RESOLVED_REFUND && refund.trim() !== ''
          ? { refundAmountInr: refund.trim() }
          : {}),
      });
      setStage('');
      setTo('');
      setNotes('');
      setRefund('');
      toast.success('Ticket moved');
    } catch (err) {
      toast.error(serverVerdict(err));
      throw err;
    }
  };

  const openedBy =
    t.openedBy === 'SELLER'
      ? 'the seller'
      : t.openedBy === 'STORE'
        ? (t.storeName ?? 'a reseller store')
        : 'Skydrop';

  return (
    <div className="af-page">
      <Link href="/tickets" className="af-back">
        <ArrowLeft size={14} aria-hidden /> All tickets
      </Link>

      <PageHeader
        // The number leads — it is what the seller quotes to us.
        title={
          <>
            <span className="sk-ident">{t.ticketNumber}</span> · {t.subject}
          </>
        }
        meta={<TicketStatusChip status={t.status} />}
        subtitle={`Raised ${new Date(t.createdAt).toLocaleString()} by ${openedBy}`}
      />

      <AfCard>
        <Facts
          items={[
            {
              label: 'Type',
              // Who is asking, then what about — in the COURIER's own
              // words, so an operator taking it to them is already
              // speaking their vocabulary.
              value: (
                <span className="tk-type-cell">
                  <span>{t.ticketType.toLowerCase().replaceAll('_', ' ')}</span>
                  <IssueCategoryLine
                    categoryLabel={t.issueCategoryLabel}
                    subcategoryLabel={t.issueSubcategoryLabel}
                  />
                </span>
              ),
            },
            ...(t.receiptNumber == null
              ? []
              : [
                  {
                    // A short-count ticket (TKT-3) is about a count,
                    // not a parcel: name the receipt and its journey.
                    label: 'Goods receipt',
                    value: (
                      <span className="sk-ident">
                        {t.receiptNumber}
                        {t.consignmentNumber == null ? '' : ` · ${t.consignmentNumber}`}
                      </span>
                    ),
                  },
                ]),
            {
              label: 'Order',
              // The NUMBER. An operator quoting a ticket to a seller
              // or a courier needs the name they both use.
              value:
                t.orderId === null ? (
                  '—'
                ) : t.orderNumber !== null ? (
                  <span className="sk-ident">{t.orderNumber}</span>
                ) : (
                  <Ident value={t.orderId} />
                ),
            },
            {
              label: 'Parcel',
              value:
                t.shipmentId === null ? (
                  '—'
                ) : t.shipmentNumber !== null ? (
                  <span className="sk-ident">{t.shipmentNumber}</span>
                ) : (
                  <Ident value={t.shipmentId} />
                ),
            },
            { label: 'Courier', value: t.courierCode ?? '—' },
            ...(t.storeName == null ? [] : [{ label: 'Reseller store', value: t.storeName }]),
            ...(t.disputePayer == null
              ? []
              : [
                  {
                    label: 'Settled',
                    value:
                      t.disputePayer === 'STORE'
                        ? 'The store paid the seller'
                        : 'The seller paid the store',
                  },
                ]),
          ]}
        />
        {/*
          The description is NOT repeated here — the conversation
          below opens with exactly this message, so printing it in the
          facts card too showed the same sentence twice a few
          centimetres apart. Facts about the ticket here; what was
          said belongs in the thread, in order, with a time on it.
          Same change as the seller page.
        */}
      </AfCard>

      {/* The conversation FIRST — it is what the ticket is. The courier
          exchange and the status machinery are how we act on it. */}
      <AfSection title="Conversation">
        <AfCard>
          <AdminTicketConversation ticket={t} />
        </AfCard>
      </AfSection>

      {/*
        The courier conversation is NOT on this page any more.

        It has its own screen — Courier escalation → Conversations —
        which does the same job with room for it, so nothing is lost:
        the manual relay to Delhivery is exactly as available as it was.
        What it was doing HERE was taking a third of a ticket page to
        say "nothing said either way yet" and offering two empty
        textareas beneath the seller conversation somebody actually came
        to read.

        This page is now one thread: the seller and us. Talking to the
        courier is a different act, in a different place, and mixing
        them is the same confusion that put two message boxes on the
        seller's ticket page.
      */}

      <AfSection title="History">
        <AfCard>
          {events.isLoading ? (
            <SkeletonRows rows={3} cols={1} label="Loading the history" />
          ) : (events.data ?? []).length === 0 ? (
            <p className="af-muted">Nothing yet.</p>
          ) : (
            <ol className="tk-history">
              {(events.data ?? []).map((e) => (
                <li key={e.id} className="tk-history__item">
                  <span className="tk-history__when sk-figure">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                  <span className="tk-history__what">
                    {e.fromStatus === null ? 'Opened' : `${e.fromStatus} → ${e.toStatus}`}
                  </span>
                  {e.note !== null && e.note !== '' && <p className="tk-history__note">{e.note}</p>}
                </li>
              ))}
            </ol>
          )}
        </AfCard>
      </AfSection>

      {/*
        RS-7 (2026-09-19) — a figure correction shows the money AS IT
        STOOD when it was raised, for anyone who reads the ticket: the
        ledger has moved since, so the live panel answers a different
        question from the one being argued.
      */}
      {t.disputeKind === 'FIGURE_CORRECTION' && t.disputedFigures != null ? (
        <AfSection title="The figures when this was raised">
          <AfCard>
            <p className="af-small">
              As at {new Date(t.disputedFigures.capturedAt).toLocaleString()} · order{' '}
              <span className="sk-ident">{t.disputedFigures.orderNumber}</span> ·{' '}
              {t.disputedFigures.paymentMode}
              {t.disputedFigures.codInr === null ? null : ` · COD ₹${t.disputedFigures.codInr}`} ·
              transfer ₹{t.disputedFigures.transferTotalInr} · retail ₹
              {t.disputedFigures.retailTotalInr}
            </p>
            <ul className="tk-figures">
              {t.disputedFigures.parties.map((p) => (
                <li key={p.party}>
                  <span className="af-strong">{p.party === 'STORE' ? 'Store' : 'Seller'}</span> net
                  ₹{p.netInr}{' '}
                  <span className="af-small">
                    (gross ₹{p.grossInr}, transfer ₹{p.transferInr}, tax ₹{p.taxShareInr}, COD fee ₹
                    {p.codFeeShareInr}, instant ₹{p.instantFeeShareInr} — {p.status.toLowerCase()})
                  </span>
                </li>
              ))}
            </ul>
            {t.disputedFigures.fees.length > 0 ? (
              <ul className="tk-figures af-small">
                {t.disputedFigures.fees.map((f) => (
                  <li key={f.fee}>
                    {f.fee}: store ₹{f.storeInr} · seller ₹{f.sellerInr} · total ₹{f.totalInr}
                  </li>
                ))}
              </ul>
            ) : null}
          </AfCard>
        </AfSection>
      ) : null}

      {canResolve && t.resolvedAt === null && isStoreDispute ? (
        <AfSection title="Settle between store and seller">
          <StoreDisputeSettle
            ticketId={ticketId}
            storeName={t.storeName ?? null}
            // RS-7 (2026-09-19) — seeded from the claim on a figure
            // correction; absent on an ordinary dispute, which leaves the
            // form exactly as it was.
            claimAmountInr={t.disputeClaimAmountInr ?? null}
            claimPayer={t.disputeClaimPayer ?? null}
          />
        </AfSection>
      ) : null}

      {canResolve && t.resolvedAt === null ? (
        <AfSection title="Move this on">
          <AfCard>
            {/*
              ONE ROW. Stage, outcome, refund, note, Apply.

              The conditional fields appear IN the row rather than under
              it, so choosing "Closed" widens the line instead of
              starting a new block — the form grows sideways as the
              decision narrows.
            */}
            <div className="tk-move">
              <Select
                id="admin-ticket-stage"
                label="Move to"
                value={stage}
                onChange={(e) => {
                  const next = e.target.value as '' | 'REVIEWING' | 'CLOSED';
                  setStage(next);
                  // Reviewing IS a status; Closed is four of them,
                  // so it waits for the second question.
                  setTo(next === 'REVIEWING' ? TicketStatus.NEGOTIATING : '');
                }}
              >
                <option value="">Choose…</option>
                {STAGES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>

              {stage === 'CLOSED' ? (
                <Select
                  id="admin-ticket-to"
                  label="How"
                  value={to}
                  onChange={(e) => setTo(e.target.value as TicketStatus | '')}
                >
                  <option value="">Outcome…</option>
                  {outcomes.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : null}

              {to === TicketStatus.RESOLVED_REFUND ? (
                <TextField
                  id="admin-ticket-refund"
                  label="Refund (INR)"
                  value={refund}
                  onChange={(e) => setRefund(e.target.value)}
                  inputMode="decimal"
                  // This credits a seller's wallet in the same
                  // transaction, so it says so where it cannot be missed.
                  title="Credited to the seller's wallet in the same transaction."
                />
              ) : null}

              <div className="tk-move__notes">
                <TextArea
                  id="admin-ticket-notes"
                  label="Notes"
                  rows={1}
                  placeholder="The seller reads this on their ticket."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  // Display only: TransitionTicketDto allows 2000.
                  countMax={2000}
                />
              </div>

              <AsyncButton
                variant="primary"
                size="md"
                labels={{ idle: 'Apply', busy: 'Applying…', done: 'Moved', error: 'Not moved' }}
                disabled={to === '' || transition.isPending}
                onClick={(e) => {
                  // A refund goes through the confirm first; the confirm
                  // then sends the same request.
                  if (to === TicketStatus.RESOLVED_REFUND) {
                    e.preventDefault();
                    setConfirmRefund(true);
                  }
                }}
                onAction={send}
              />
            </div>
          </AfCard>

          <ConfirmDialog
            open={confirmRefund}
            onOpenChange={setConfirmRefund}
            title="Refund the seller?"
            entity={t.ticketNumber}
            entityIsIdentifier
            amount={refund.trim() === '' ? undefined : <Money amount={refund.trim()} />}
            consequence="The seller's wallet is credited the amount typed, in the same transaction, and the ticket closes as refunded."
            confirmLabel="Refund and close"
            onConfirm={send}
          />
        </AfSection>
      ) : null}
    </div>
  );
}
