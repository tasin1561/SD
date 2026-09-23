'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { CustomerRiskStrip } from './customer-risk-strip';
import { Money, ProductThumb } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { Select } from '@skydrop/ui/app/select';
import { TextField } from '@skydrop/ui/app/text-field';
import { DateField } from '@skydrop/ui/app/date-field';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { Timeline, type TimelineStep } from '@skydrop/ui/app/timeline';
import { useToast } from '@skydrop/ui/app/toast';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import type { CallOrderSnapshot, PulledAssignment } from '@skydrop/api-client';
import { callBrandLine } from '@/lib/call-brand';
import { PhoneToCall } from '@/components/phone-to-call';
import {
  usePullNextCall,
  useRecordCallAttempt,
  useReleaseCall,
  useCurrentCalls,
} from '@/lib/api-hooks';
import { CallOutcome } from '@skydrop/db';
import { MyAvailability } from './my-availability';
import { MyCallHistory } from './my-call-history';
import { useServiceabilityCheck } from '@/lib/ops-hooks';
import { useTransitionTicket } from '@/lib/ops-hooks';
import Link from 'next/link';
import { MessageCircleWarning, PhoneCall, TriangleAlert } from 'lucide-react';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { Facts, Notice, OoCard } from '../../orders/_components/order-ops-parts';
import './call-center.css';

const OUTCOME_OPTIONS: ReadonlyArray<{
  value: CallOutcome;
  label: string;
  helper: string;
}> = [
  {
    value: 'CONFIRMED' as CallOutcome,
    label: 'Confirmed',
    helper: 'Customer agreed → reserves stock + advances order',
  },
  {
    value: 'CUSTOMER_DECLINED' as CallOutcome,
    label: 'Declined',
    helper: 'Customer no longer wants the order',
  },
  { value: 'WRONG_NUMBER' as CallOutcome, label: 'Wrong number', helper: 'Reached someone else' },
  { value: 'NO_ANSWER' as CallOutcome, label: 'No answer', helper: 'Did not pick up' },
  { value: 'BUSY' as CallOutcome, label: 'Busy', helper: 'Line was busy' },
  { value: 'VOICEMAIL_LEFT' as CallOutcome, label: 'Voicemail', helper: 'Left a message' },
  {
    value: 'CALLBACK_REQUESTED' as CallOutcome,
    label: 'Callback requested',
    helper: 'Customer asked to call back at a specific time',
  },
  {
    value: 'TECHNICAL_FAILURE' as CallOutcome,
    label: 'Technical failure',
    helper: 'Line dropped, system fault — no order transition',
  },
  {
    value: 'LANGUAGE_BARRIER' as CallOutcome,
    label: 'Language barrier',
    helper: 'Could not communicate — no order transition',
  },
];

/** How long to wait before looking again when the queue came back empty. */
const EMPTY_QUEUE_RETRY_MS = 15_000;

/** Comfortably inside the shortest sensible presence window, so a
 *  present agent is never stood down between two beats. */
const HEARTBEAT_MS = 60_000;

/**
 * What the agent actually reads out, as one string.
 *
 * Deliberately NOT the order's `updatedAt`: any write to the row moves
 * it (rule 4b), so a nightly cost sync or an attribution backfill would
 * flash "the seller changed this order" at an agent mid-call about a
 * change nobody made — and a warning that fires on noise is one people
 * learn to ignore. This moves only when something the agent is saying to
 * the customer moves.
 */
function callSignature(a: PulledAssignment): string {
  const o = a.order;
  if (o === null) return '';
  const r = o.recipient;
  return JSON.stringify([
    r.name,
    r.phoneE164,
    r.altPhoneE164,
    r.addressLine1,
    r.addressLine2,
    r.landmark,
    r.city,
    r.stateProvince,
    r.postalCode,
    o.paymentMode,
    o.codAmountInr,
    o.items.map((i) => [i.skuCode, i.quantity]),
  ]);
}

export function CallCenterStation(): ReactElement {
  const toast = useToast();
  const client = useApiClient();
  const pull = usePullNextCall();
  const record = useRecordCallAttempt();
  const release = useReleaseCall();

  // Availability is the stop control. The same query key the
  // MyAvailability card writes, so toggling it there takes effect here
  // immediately without a second source of truth.
  const settings = useQuery({
    queryKey: ['agent-settings', 'me'],
    queryFn: () => client.request<{ isAvailable: boolean }>('/api/agent/settings'),
  });
  const isAvailable = settings.data?.isAvailable ?? false;

  /**
   * What this agent is ALREADY holding, per the database.
   *
   * The held call used to live only in React state seeded from the pull
   * response, so a reload — or navigating away and back — lost it while
   * the queue entry stayed ASSIGNED to them in the database. The station
   * then showed "Waiting for the next call" over a call they were still
   * holding, every pull came back AGENT_AT_CAPACITY, and there was no
   * way to record an outcome or release it from any screen. The only
   * escapes were the CC-7 expiry timer or an admin reassigning it.
   *
   * The endpoint and this hook both already existed and nothing called
   * them; adopting the row on mount is the whole fix.
   */
  const current = useCurrentCalls();

  const [assignment, setAssignment] = useState<PulledAssignment | null>(null);
  const hasOpenIssues = (assignment?.openTickets.length ?? 0) > 0;
  const isConfirmationCall = assignment?.callPurpose.kind === 'CONFIRMATION';

  /**
   * Two different jobs, two different vocabularies.
   *
   * A CONFIRMATION call asks "does the customer still want this?", and
   * the nine outcomes answer exactly that. A ticket call asks whatever
   * the seller asked; the answer is the NOTE, and the only thing the
   * dropdown has to record is that the call happened. Offering nine
   * order-shaped outcomes there invited an agent to pick one that moves
   * an order which must not move.
   */
  const orderedOutcomes = isConfirmationCall
    ? OUTCOME_OPTIONS
    : ([
        {
          value: 'SPOKE_TO_CUSTOMER' as CallOutcome,
          label: 'Called',
          helper: 'What they said goes in the note below — the seller reads it.',
        },
      ] as typeof OUTCOME_OPTIONS);
  /** Whether the held-call check has answered — the auto-advance must
   *  not pull before it has, or the first tick races it to a certain
   *  AGENT_AT_CAPACITY. */
  const [bootstrapped, setBootstrapped] = useState(false);
  /** Last look found nothing — drives the copy, not the schedule. */
  const [queueEmpty, setQueueEmpty] = useState(false);
  const [outcome, setOutcome] = useState<CallOutcome | ''>('');
  const [notes, setNotes] = useState('');
  const [callbackTime, setCallbackTime] = useState('');
  // Ticking this closes the seller's issues in the SAME action as the
  // outcome, so the agent never has to scroll back up to a banner to
  // finish the job they just did.
  //
  // Defaults to ON: the seller asked a question, the agent rang and
  // answered it, and that is the ordinary end of it. Making them tick a
  // box to finish the normal case leaves tickets open through nothing
  // but forgetfulness — and an issue left open costs the seller a chase,
  // whereas one closed too eagerly costs a reopen.
  const [closeIssues, setCloseIssues] = useState(true);
  const transitionTicket = useTransitionTicket();
  // FE-2: cosmetic. The server enforces this regardless — but an agent
  // who may not resolve tickets should not be offered a checkbox that
  // fails after they have already recorded the call.
  const canResolveTickets = usePermission('tickets.resolve');
  const [error, setError] = useState<string | null>(null);

  function fmtError(err: unknown): string {
    return serverVerdict(err, 'Operation failed');
  }

  function resetCall(): void {
    setAssignment(null);
    setChangedUnderMe(false);
    setOutcome('');
    setNotes('');
    setCallbackTime('');
    setCloseIssues(true);
  }

  /**
   * Claim the next entry.
   *
   * `pullNext` stays the mechanism even though this is now automatic:
   * it claims a row with FOR UPDATE SKIP LOCKED inside the assigning
   * transaction, so two agents advancing at the same instant can never
   * be handed the same customer. What changed is only WHO triggers it.
   *
   * Push-assigning from the server would break the other half of that
   * guarantee — an order handed to an agent who has stepped away sits
   * ASSIGNED and uncalled until the expiry timer fires. Pulling on the
   * agent's own action proves someone is actually at the desk.
   */
  const advance = useCallback(
    async (announce: boolean): Promise<void> => {
      setError(null);
      try {
        const r = await pull.mutateAsync();
        if (!r.assignment) {
          setQueueEmpty(true);
          if (announce) toast.info('Queue is empty.');
          return;
        }
        setQueueEmpty(false);
        setAssignment(r.assignment);
        setOutcome('');
        setNotes('');
        setCallbackTime('');
        setCloseIssues(true);
      } catch (err) {
        setError(fmtError(err));
      }
    },
    // `toast` and `pull` are stable; fmtError is a pure local helper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Auto-advance. An agent should not have to ask for work between
  // every call — they log an outcome and the next customer is there.
  // Gated on availability, so ending a shift or stepping away actually
  // stops the flow rather than piling up assignments nobody is calling.
  //
  // Two triggers, deliberately separate:
  //   • straight after an outcome is recorded — an explicit call in
  //     onRecord, so the next customer appears immediately;
  //   • a steady interval — for the case where the queue was empty and
  //     work arrives later.
  //
  // The interval depends ONLY on availability, and each tick reads live
  // state through a ref. An earlier version keyed the effect on
  // assignment / isPending / queueEmpty and rebuilt its timer whenever
  // any of them changed: unrelated re-renders reset the schedule, and
  // measuring it gave 4 pulls in 20s on one run and 0 in 50s on the
  // next. A schedule that unreliable is worse than no schedule.
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  /**
   * "I am still here."
   *
   * Availability is a claim about being AT the desk, and a boolean in a
   * table cannot go stale on its own — an agent who marked themselves
   * available and walked away kept claiming orders, because this
   * component's auto-advance needs no human present. The server stands
   * down anyone it has not heard from; this is the hearing.
   *
   * Gated on `document.visibilityState`, which is the whole point: a
   * backgrounded or forgotten tab must NOT keep someone on the roster.
   * Browsers also throttle timers in hidden tabs, so an ungated
   * heartbeat would be unreliable exactly when it mattered.
   */
  useEffect(() => {
    if (!isAvailable) return;
    const beat = (): void => {
      if (document.visibilityState !== 'visible') return;
      void client.request('/api/agent/settings/heartbeat', { method: 'POST' }).catch(() => {
        // Best-effort: a missed beat costs at most one sweep window, and
        // failing loudly here would interrupt a live call for nothing.
      });
    };
    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', beat);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', beat);
    };
  }, [isAvailable, client]);

  // Adopt whatever this agent is already holding, ONCE, before any
  // pulling starts. Runs on the query settling either way: an agent
  // holding nothing still needs the gate opened, or the station would
  // never advance at all.
  const adoptedRef = useRef(false);
  useEffect(() => {
    if (adoptedRef.current) return;
    if (!current.isSuccess) return;
    adoptedRef.current = true;
    // Cap is 1 at the Phase-1A default; take the oldest if that ever
    // rises, which is the order listCurrent already returns them in.
    const held = current.data.assignments[0];
    if (held) {
      setAssignment(held);
      setQueueEmpty(false);
    }
    setBootstrapped(true);
  }, [current.isSuccess, current.data]);

  /*
    THE ORDER IN HAND IS RE-READ, AND A CHANGE IS SAID OUT LOUD
    (owner decision 4, 2026-09-18).

    `EDIT_DURING_CALL` is gone: a seller — and now a reseller store — may
    change an order while an agent holds it, because the moment an agent
    is told "that flat number is wrong" is exactly the moment it needs
    fixing. What made that refusal look safe was never true: the station
    copied the pulled assignment into React state and never looked again,
    so an admin edit, a god-mode change, a CSV patch or a second agent
    could already have moved the order under the agent with nothing said.

    So the held call is re-read (`useCurrentCalls` polls) and compared on
    WHAT THE AGENT READS OUT — the recipient, the lines, the amount. A
    server `updatedAt` would be wrong here for the reason rule 4b gives:
    any write to the row moves it, so a nightly job would flash a warning
    about a change nobody made. A content signature never false-alarms.
  */
  const [changedUnderMe, setChangedUnderMe] = useState(false);
  useEffect(() => {
    if (!current.isSuccess || assignment === null) return;
    const fresh = current.data.assignments.find((a) => a.orderId === assignment.orderId);
    if (fresh === undefined) return;
    if (callSignature(fresh) === callSignature(assignment)) return;
    setAssignment(fresh);
    setChangedUnderMe(true);
  }, [current.isSuccess, current.data, assignment]);

  const idleRef = useRef(false);
  idleRef.current = isAvailable && bootstrapped && assignment === null && !pull.isPending;

  /** Nobody is reading a hidden tab, so it must not take work. Without
   *  this the auto-advance re-claims an order every 15s for as long as a
   *  forgotten tab stays open, which is precisely how the CC-7 expiry
   *  was defeated: it handed the order back and the tab took it again. */
  const humanPresent = (): boolean =>
    typeof document === 'undefined' || document.visibilityState === 'visible';

  // First look, the moment the held-call check clears and there is
  // nothing to hold. Separate from the interval below because that one
  // depends ONLY on availability on purpose (see above) — folding
  // `bootstrapped` into its deps would rebuild the timer.
  useEffect(() => {
    if (!isAvailable || !bootstrapped) return;
    if (idleRef.current && humanPresent()) void advanceRef.current(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAvailable, bootstrapped]);

  useEffect(() => {
    if (!isAvailable) return;
    const id = setInterval(() => {
      if (idleRef.current && humanPresent()) void advanceRef.current(false);
    }, EMPTY_QUEUE_RETRY_MS);
    return () => clearInterval(id);
  }, [isAvailable]);

  // One option is not a choice. Pre-selecting it means a ticket call is
  // "write the note, press the button" rather than a dropdown that
  // exists only to be satisfied.
  useEffect(() => {
    if (assignment && !isConfirmationCall && outcome === '') {
      setOutcome('SPOKE_TO_CUSTOMER' as CallOutcome);
    }
  }, [assignment, isConfirmationCall, outcome]);

  async function onRecord(): Promise<void> {
    if (!assignment || !outcome) return;
    setError(null);
    const startedAt = assignment.assignedAt;
    const endedAt = new Date().toISOString();

    const payload: Parameters<typeof record.mutate>[0] = {
      assignmentId: assignment.assignmentId,
      outcome,
      startedAt,
      endedAt,
      ...(notes.trim() ? { outcomeNotes: notes.trim() } : {}),
      ...(outcome === 'CALLBACK_REQUESTED' && callbackTime
        ? { scheduledFor: new Date(callbackTime).toISOString() }
        : {}),
    };

    if (outcome === 'CALLBACK_REQUESTED' && !callbackTime) {
      setError('Callback time is required for "Callback requested".');
      return;
    }

    try {
      const r = await record.mutateAsync(payload);

      // AFTER the record, never before: the outcome is written onto the
      // ticket, so closing first would leave the seller a resolved issue
      // that never says what happened. Per ticket and isolated — one
      // failing must not stop the others closing.
      let closed = 0;
      if (closeIssues && canResolveTickets) {
        for (const t of assignment.openTickets) {
          try {
            await transitionTicket.mutateAsync({
              ticketId: t.ticketId,
              to: 'RESOLVED_WRITE_OFF_ACCEPTED',
              notes: notes.trim() === '' ? 'Closed after speaking to the customer.' : notes.trim(),
            });
            closed += 1;
          } catch {
            // Reported below rather than thrown: the call IS recorded,
            // and losing that because a ticket would not close is the
            // wrong trade.
          }
        }
      }

      const tail =
        r.finalOrderStatus !== null ? `order → ${r.finalOrderStatus}` : 'no order transition';
      const closedTail =
        closeIssues && closed < assignment.openTickets.length
          ? ` · ${closed}/${assignment.openTickets.length} issues closed — check the rest by hand`
          : closed > 0
            ? ` · ${closed} issue${closed === 1 ? '' : 's'} closed`
            : '';
      toast.success(`Recorded ${r.outcome} · ${tail}${closedTail}`);
      resetCall();
      // Immediately, not on the next tick — the agent has just hung up
      // and the whole point is that the next customer is already there.
      void advance(false);
    } catch (err) {
      setError(fmtError(err));
    }
  }

  async function onRelease(): Promise<void> {
    if (!assignment) return;
    setError(null);
    try {
      await release.mutateAsync({ assignmentId: assignment.assignmentId });
      toast.info('Released — entry returns to the queue.');
      resetCall();
    } catch (err) {
      setError(fmtError(err));
    }
  }

  return (
    <div className="oo-stack">
      {/* First, because it is the thing an agent changes most often and
          the thing that costs most when it is left wrong. */}
      <MyAvailability />

      <div className="cc-actions">
        {/* Calls arrive on their own while available; this is the
            manual nudge for "the queue was empty, try now". The rolling
            label is driven by the real pull (controlled state), so it
            never delays one. */}
        <AsyncButton
          variant="primary"
          size="md"
          icon={<PhoneCall size={16} />}
          state={pull.isPending ? 'busy' : 'idle'}
          labels={{
            idle: assignment ? 'Active call' : 'Check for a call now',
            busy: 'Finding next call…',
          }}
          onClick={() => void advance(true)}
          disabled={pull.isPending || assignment !== null || !isAvailable}
        />
        {assignment && (
          <AsyncButton
            variant="ghost"
            size="md"
            state={release.isPending ? 'busy' : 'idle'}
            labels={{ idle: 'Release without attempt', busy: 'Releasing…' }}
            onClick={() => void onRelease()}
            disabled={release.isPending}
          />
        )}
      </div>

      {error && (
        <Notice tone="bad" icon={<TriangleAlert size={16} />}>
          <p className="oo-error">{error}</p>
        </Notice>
      )}

      {!assignment ? (
        <EmptyState
          tone={isAvailable && queueEmpty ? 'positive' : 'neutral'}
          title={isAvailable ? 'Waiting for the next call' : 'You are marked unavailable'}
          description={
            !isAvailable
              ? 'Mark yourself available above to start receiving calls.'
              : queueEmpty
                ? 'Nobody is waiting to be called right now. The queue is checked again every few seconds — you do not need to do anything.'
                : 'The next customer in the queue is handed to you automatically.'
          }
        />
      ) : (
        <OoCard>
          {changedUnderMe ? (
            /* The seller or the reseller store changed this order while
               it was in your hand (owner decision 4, 2026-09-18). The
               panel below is already showing the NEW one — this is here
               so the agent knows to read it again rather than carry on
               from memory. Dismissible, because after they have looked
               it is just noise. */
            <Notice
              tone="warn"
              role="status"
              icon={<TriangleAlert size={16} />}
              title="This order changed while you were on the call"
            >
              <p className="oo-p">
                The seller or the store that sold it has just changed something. What is on this
                screen is the new version — read the address and the items again before you confirm
                anything.
              </p>
              <div>
                <Button variant="ghost" size="sm" onClick={() => setChangedUnderMe(false)}>
                  I have read it
                </Button>
              </div>
            </Notice>
          ) : null}
          <div className="cc-call-head">
            <p className="cc-call-head__title">
              Assignment <span className="sk-ident">{assignment.assignmentId.slice(0, 8)}</span>
            </p>
            <span className="oo-faint">
              {/* NOT +1: scheduledAttempts is incremented by pullNext
                  itself, so it already counts this claim. The old
                  expression said "attempt #2" on an agent's first
                  call. It counts claims rather than conversations —
                  an expiry and re-pull raises it without anyone
                  having phoned — so it is worded as such. */}
              Order <span className="sk-ident">{assignment.orderId}</span> · pull #
              <span className="sk-figure">{assignment.scheduledAttempts}</span>
            </span>
          </div>

          {/* FIRST thing on the card, above the customer's history and
              the parcel itself. The agent's opening sentence depends
              on this and nothing else on the page says it: the queue
              entry carries an order id, so "confirm your order" and
              "the seller asked us to ring you" looked identical here
              until now. Opening with the wrong one tells a customer
              whose parcel is already out for delivery that we have
              lost track of it. */}
          <CallPurposeBanner purpose={assignment.callPurpose} tickets={assignment.openTickets} />
          {/* Above the customer's details, not below them: an agent
              reads top-down with the phone already ringing, and a
              warning under the address is a warning read after the
              call has started. Renders nothing for a first-time
              customer. */}
          <CustomerRiskStrip orderId={assignment.orderId} />
          <RecipientPanel
            order={assignment.order}
            seller={assignment.seller}
            customerBrand={assignment.customerBrand ?? null}
            itemDisplay={assignment.itemDisplay}
          />
          {/* Above the outcome form on purpose: the agent needs the
              last conversation BEFORE they dial, not after they have
              opened with the wrong sentence. */}
          <PriorAttempts attempts={assignment.priorAttempts} />

          <div className="cc-form">
            <Select
              label="Outcome"
              requiredMark
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as CallOutcome | '')}
            >
              <option value="">Select an outcome…</option>
              {/*
                On a follow-up the confirmation pair sinks to the
                bottom: they are the only two that move an order, and
                on a shipped parcel neither can. Ordering, not
                hiding — an agent who needs one can still reach it
                (FE-2: the UI does not pre-empt the server).
              */}
              {orderedOutcomes.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>

            {/*
              The nine outcomes are the CONFIRMATION vocabulary, and
              two of them move the order. On a parcel that has already
              shipped those two do nothing — the state machine has no
              edge from OUT_FOR_DELIVERY back to confirmed or
              cancelled, so the transition is refused and swallowed
              (CC-3) while the attempt is still recorded. Saying so is
              better than letting an agent pick one and assume it
              worked.
            */}
            {outcome && (
              <p className="cc-form__helper">
                {orderedOutcomes.find((o) => o.value === outcome)?.helper}
              </p>
            )}

            {outcome === 'CALLBACK_REQUESTED' && (
              <DateField
                label="Callback scheduled for"
                requiredMark
                type="datetime-local"
                value={callbackTime}
                onChange={(e) => setCallbackTime(e.target.value)}
              />
            )}

            {/*
              This field is the ANSWER to whatever the seller asked.
              It was labelled "Notes / free-form (audited)", which told
              an agent it was a private scratchpad — so the one thing
              the seller is waiting for was the thing least likely to
              get written.
            */}
            <TextField
              label={hasOpenIssues ? 'What the customer told you' : 'Notes'}
              hint={
                hasOpenIssues
                  ? 'Written onto the seller’s open issue word for word — this is how they find out what happened.'
                  : 'Free-form, audited.'
              }
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                hasOpenIssues
                  ? 'e.g. Customer will be home after 6pm and asked us to try again tomorrow'
                  : 'Free-form notes (audited)'
              }
            />

            {hasOpenIssues && canResolveTickets ? (
              <Checkbox
                checked={closeIssues}
                onChange={(e) => setCloseIssues(e.target.checked)}
                label={
                  <>
                    Close the seller’s {assignment.openTickets.length === 1 ? 'issue' : 'issues'}{' '}
                    after recording
                  </>
                }
                description="Untick it if you still owe them something — a re-attempt to arrange, or another call."
              />
            ) : null}

            <div className="cc-form__submit">
              <AsyncButton
                variant="primary"
                size="md"
                state={record.isPending ? 'busy' : 'idle'}
                labels={{ idle: 'Record outcome', busy: 'Recording…' }}
                disabled={record.isPending || !outcome}
                onClick={() => void onRecord()}
              />
            </div>
          </div>
        </OoCard>
      )}

      {/* Between calls, not during one — collapsed so the live call
          keeps the screen. */}
      <MyCallHistory />
    </div>
  );
}

function RecipientPanel({
  order,
  seller,
  customerBrand,
  itemDisplay,
}: {
  readonly order: CallOrderSnapshot | null;
  readonly seller: PulledAssignment['seller'];
  readonly customerBrand: NonNullable<PulledAssignment['customerBrand']> | null;
  readonly itemDisplay: PulledAssignment['itemDisplay'];
}): ReactElement {
  // ABOVE the early return. A hook called after one runs in a different
  // order on the render where the order failed to load, which React
  // refuses outright. The query is disabled on a missing pin anyway, so
  // asking here costs nothing.
  //
  // Asked while the agent has the customer on the line — the last
  // moment a bad address is cheap to fix. Cached server-side for a day.
  const serviceability = useServiceabilityCheck(
    order?.recipient.postalCode ?? null,
    order?.paymentMode === 'PREPAID' ? 'PREPAID' : 'COD',
  );

  if (order === null) {
    // listCurrent/pullNext log this server-side; the agent still needs
    // to be told rather than shown a card of dashes.
    return (
      <Notice tone="warn" icon={<TriangleAlert size={16} />}>
        <p className="oo-p">
          This order could not be loaded. Release the call and tell a supervisor.
        </p>
      </Notice>
    );
  }

  // The recipient block is NESTED (`recipient.name`, not
  // `recipientName`). This panel used to cast an `unknown` payload to
  // the flat column names, so every field here rendered "—" and an
  // agent was asked to phone a number the screen would not show.
  const r = order.recipient;
  // RS-10 — whom this call is on behalf of (a reseller store or the seller).
  const { orderedFrom, isReseller } = callBrandLine(seller, customerBrand);

  const facts: Array<{ label: ReactNode; value: ReactNode }> = [
    { label: 'Name', value: r.name || '—' },
    {
      label: 'Address',
      value: [r.addressLine1, r.addressLine2, r.landmark].filter(Boolean).join(', ') || '—',
    },
    // Surfaced here, not enforced. An agent who learns the pin is not
    // deliverable can ask for another address while the customer is
    // still on the phone — which is the entire value. Blocking the
    // confirmation instead would leave them holding a refusal with
    // nowhere to put it.
    ...(serviceability.data?.known === true && !serviceability.data.serviceable
      ? [
          {
            label: 'Delivery',
            value: (
              <span className="oo-warn">
                {serviceability.data.reason ??
                  'Our courier may not deliver to this PIN — ask for an alternative address.'}
              </span>
            ),
          },
        ]
      : []),
    {
      label: 'City / state / PIN',
      // Filtering on EMPTY STRING, not nullishness: city/state are
      // stored as '' for orders whose seller never supplied them
      // (ORD-5). An agent reading "· · 560001" aloud is the failure.
      value:
        [r.city, r.stateProvince, r.postalCode].filter((v) => v.trim() !== '').join(' · ') || '—',
    },
    ...(isReseller &&
    customerBrand !== null &&
    (customerBrand.storeContactPhone !== null || customerBrand.storeContactEmail !== null)
      ? [
          {
            label: 'Store contact',
            value: [customerBrand.storeContactPhone, customerBrand.storeContactEmail]
              .filter((v): v is string => v !== null && v.trim() !== '')
              .join(' · '),
          },
        ]
      : []),
    ...(seller !== null
      ? [
          {
            label: isReseller ? 'Seller contact (not for the customer)' : 'Seller contact',
            // For the questions an agent cannot answer — a substitution,
            // a discount the customer says they were promised. Reaching
            // the shop takes a call, not a support ticket.
            value: `${seller.contactPersonName} · ${seller.phone}`,
          },
        ]
      : []),
    {
      label: 'Payment',
      value:
        order.paymentMode === 'COD' && order.codAmountInr !== null ? (
          // The agent reads this figure aloud to the customer, so it
          // is grouped the way they expect to hear it: ₹12,34,567.
          <span>
            COD <Money amount={order.codAmountInr} />
          </span>
        ) : (
          order.paymentMode || '—'
        ),
    },
  ];

  return (
    <div className="cc-recipient">
      <div className="cc-recipient__head">
        <span className="cc-recipient__order sk-ident">{order.orderNumber}</span>
        {orderedFrom !== null && (
          // The agent opens with this: "calling about your order from
          // <store>". A customer phoned by a company they do not
          // recognise hangs up, and in a COD market that is a refusal.
          // RS-10: for a reseller-store order that is THE STORE's name.
          <span className="cc-recipient__from" data-testid="ordered-from">
            <span>
              Ordered from <strong>{orderedFrom}</strong>
            </span>
            {isReseller && <span className="cc-tag">Reseller store</span>}
          </span>
        )}
      </div>

      {isReseller && (
        // RS-10 — the script. The customer bought from the store and
        // has never heard of the seller behind it; naming the seller
        // on the phone reads as a stranger calling about their parcel.
        <p className="oo-script" data-testid="reseller-script">
          Say you are calling about their order from <strong>{orderedFrom}</strong>. Do not mention
          the seller behind the store.
        </p>
      )}

      <div>
        <PhoneToCall phone={r.phoneE164} altPhone={r.altPhoneE164} />
      </div>

      {/* 14px, not 12: an agent reads this card for a whole shift while
          talking, and small grey text is where a digit or a house
          number gets misread. The VALUE carries the weight. */}
      <Facts items={facts} columns={2} />

      {order.items.length > 0 && (
        <div>
          <div className="cc-items__label">Items</div>
          <ul className="cc-items">
            {order.items.map((it, idx) => {
              // Live catalogue read, keyed on variant — the snapshot's
              // own imageUrl is a canonical object URL that has resolved
              // for nobody since the bucket went private.
              const display = itemDisplay[it.variantId];
              return (
                <li key={`${it.skuCode}-${idx}`} className="cc-item">
                  <ProductThumb src={display?.thumbnailUrl ?? null} size={44} />
                  <div className="cc-item__text">
                    <span className="cc-item__name">
                      {it.productName}
                      {it.variantLabel ? ` · ${it.variantLabel}` : ''}
                    </span>
                    <span className="cc-item__meta">
                      <span className="sk-figure">×{it.quantity}</span> ·{' '}
                      <span className="sk-ident">{it.skuCode}</span>
                    </span>
                    {display?.description !== null && display?.description !== undefined && (
                      // Clamped: a product description can run to
                      // paragraphs, and the agent needs the gist while
                      // the customer is on the line, not an essay
                      // pushing the outcome form off the screen.
                      <p className="cc-item__desc">{display.description}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

const WHEN: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
};

/**
 * What happened the last times this order was called.
 *
 * Distinct from "My calls" at the bottom of the page, which is the
 * AGENT's own log across every order — useful for reviewing your shift,
 * useless for the customer in front of you. This is the customer's
 * thread: attempt two should open where attempt one left off. Drawn as
 * the u17 timeline because it IS an event history.
 */
function PriorAttempts({
  attempts,
}: {
  readonly attempts: PulledAssignment['priorAttempts'];
}): ReactElement | null {
  // A first call has no history, and an empty box saying so is noise on
  // the screen an agent uses most.
  if (attempts.length === 0) return null;

  const thisOrder = attempts.filter((a) => a.isThisOrder);
  const earlier = attempts.filter((a) => !a.isThisOrder);

  function step(a: (typeof attempts)[number]): TimelineStep {
    return {
      id: a.attemptId,
      state: 'done',
      label: (
        <>
          {OUTCOME_OPTIONS.find((o) => o.value === a.outcome)?.label ?? a.outcome}
          {!a.isThisOrder && (
            <>
              {' '}
              <span className="oo-faint">
                on <span className="sk-ident">{a.orderNumber}</span>
              </span>
            </>
          )}
        </>
      ),
      time: new Date(a.startedAt).toLocaleString('en-IN', WHEN),
      ...(a.agentEmail !== null ? { location: a.agentEmail } : {}),
      description: (
        <>
          {a.rescheduledFor !== null && (
            // The promise the customer was given. Breaking it is worse
            // than never having made it.
            <span className="cc-prior__promise">
              Promised callback: {new Date(a.rescheduledFor).toLocaleString('en-IN', WHEN)}
            </span>
          )}
          {a.notes !== null && a.notes !== '' ? (
            <span className="cc-prior__notes">{a.notes}</span>
          ) : (
            // Said out loud rather than left blank: "nobody wrote anything
            // down" and "the notes failed to load" look identical
            // otherwise, and only one of them means stop looking.
            <span className="cc-prior__none">No notes recorded</span>
          )}
        </>
      ),
    };
  }

  return (
    <div className="cc-prior">
      <h3 className="cc-prior__title">
        What this customer was told before
        <span className="cc-prior__count">
          {attempts.length} previous {attempts.length === 1 ? 'call' : 'calls'}
        </span>
      </h3>

      {thisOrder.length > 0 && (
        <Timeline
          label="Previous calls about this order"
          stateWords={{ done: 'Logged' }}
          steps={thisOrder.map(step)}
        />
      )}

      {earlier.length > 0 && (
        <>
          {/* Kept separate and clearly labelled: a call about a
              different parcel is still context — "she always asks for
              after seven" — but it is not about the one being discussed,
              and an agent must not confuse the two on the phone. */}
          <p className="cc-prior__group">Earlier orders by the same customer</p>
          <Timeline
            label="Previous calls about this customer's other orders"
            stateWords={{ done: 'Logged' }}
            steps={earlier.map(step)}
          />
        </>
      )}
    </div>
  );
}

/**
 * Why this call is happening, and what the seller asked for.
 *
 * Deliberately loud and first. Everything else on this card describes
 * the parcel; this is the only thing that tells the agent which
 * conversation they are about to have.
 */
function CallPurposeBanner({
  purpose,
  tickets,
}: {
  readonly purpose: PulledAssignment['callPurpose'];
  readonly tickets: PulledAssignment['openTickets'];
}): ReactElement {
  return (
    <div className="cc-purpose">
      <p className="cc-purpose__kicker">
        <MessageCircleWarning size={15} aria-hidden />
        Why this call
      </p>
      <p className="cc-purpose__headline">{purpose.headline}</p>

      {purpose.sellerAsked !== null ? (
        <p className="cc-purpose__said">
          <span className="oo-muted">They told us: </span>
          &ldquo;{purpose.sellerAsked}&rdquo;
        </p>
      ) : null}

      {tickets.length > 0 ? (
        <ul className="cc-purpose__tickets">
          {tickets.map((t) => (
            <li key={t.ticketId} className="cc-purpose__ticket">
              <p>
                <span className="oo-strong">{t.subject}</span>
                {t.detail === null || t.detail.trim() === '' ? null : (
                  <span className="oo-muted">: {t.detail}</span>
                )}
              </p>
              <Link href={`/tickets?ticketId=${t.ticketId}`} className="oo-link">
                Open
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        The normal path is the outcome form below, which records the call
        and closes these in one action. Close here is the exception: an
        issue that needs no call at all — already answered elsewhere, or
        raised in error.
      */}
      {tickets.length > 0 ? (
        <p className="oo-faint">
          Answer these on the call, then record the outcome below — it is written onto the issue and
          can close it in the same step.
        </p>
      ) : null}
    </div>
  );
}
