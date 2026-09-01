'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { CustomerRiskStrip } from './customer-risk-strip';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  Money,
  FormField,
  Input,
  Select,
  useToast,
} from '@skydrop/ui/components';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import { ApiError } from '@skydrop/api-client';
import type { CallOrderSnapshot, PulledAssignment } from '@skydrop/api-client';
import { PhoneToCall } from '@/components/phone-to-call';
import { ProductThumb } from '@skydrop/ui/components';
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
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { useTransitionTicket } from '@/lib/ops-hooks';
import Link from 'next/link';

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
  const [closeIssues, setCloseIssues] = useState(false);
  const transitionTicket = useTransitionTicket();
  const [error, setError] = useState<string | null>(null);

  function fmtError(err: unknown): string {
    if (err instanceof ApiError) {
      const b = err.body as { code?: unknown; message?: unknown } | null;
      const code = typeof b?.code === 'string' ? b.code : null;
      const msg = typeof b?.message === 'string' ? b.message : err.message;
      return code ? `[${code}] ${msg}` : msg;
    }
    return err instanceof Error ? err.message : 'Operation failed';
  }

  function resetCall(): void {
    setAssignment(null);
    setOutcome('');
    setNotes('');
    setCallbackTime('');
    setCloseIssues(false);
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
        setCloseIssues(false);
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
      if (closeIssues) {
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
    <div className="space-y-4">
      {/* First, because it is the thing an agent changes most often and
          the thing that costs most when it is left wrong. */}
      <MyAvailability />

      <div className="flex items-center gap-2">
        {/* Calls arrive on their own while available; this is the
            manual nudge for "the queue was empty, try now". */}
        <Button
          variant="primary"
          size="md"
          onClick={() => void advance(true)}
          disabled={pull.isPending || assignment !== null || !isAvailable}
        >
          {pull.isPending
            ? 'Finding next call…'
            : assignment
              ? 'Active call'
              : 'Check for a call now'}
        </Button>
        {assignment && (
          <Button
            variant="ghost"
            size="md"
            onClick={() => void onRelease()}
            disabled={release.isPending}
          >
            {release.isPending ? 'Releasing…' : 'Release without attempt'}
          </Button>
        )}
      </div>

      {error && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
          {error}
        </div>
      )}

      {!assignment ? (
        <EmptyState
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
        <Card>
          <CardBody>
            <div className="mb-3">
              <div className="text-text-bright font-medium text-sm">
                Assignment {assignment.assignmentId.slice(0, 8)}
              </div>
              <div className="text-text-faint text-xs mt-0.5">
                {/* NOT +1: scheduledAttempts is incremented by pullNext
                    itself, so it already counts this claim. The old
                    expression said "attempt #2" on an agent's first
                    call. It counts claims rather than conversations —
                    an expiry and re-pull raises it without anyone
                    having phoned — so it is worded as such. */}
                Order {assignment.orderId} · pull #{assignment.scheduledAttempts}
              </div>
            </div>

            {/* Above the customer's details, not below them: an agent
                reads top-down with the phone already ringing, and a
                warning under the address is a warning read after the
                call has started. Renders nothing for a first-time
                customer. */}
            {/* FIRST thing on the card, above the customer's history and
                the parcel itself. The agent's opening sentence depends
                on this and nothing else on the page says it: the queue
                entry carries an order id, so "confirm your order" and
                "the seller asked us to ring you" looked identical here
                until now. Opening with the wrong one tells a customer
                whose parcel is already out for delivery that we have
                lost track of it. */}
            <CallPurposeBanner purpose={assignment.callPurpose} tickets={assignment.openTickets} />
            <CustomerRiskStrip orderId={assignment.orderId} />
            <RecipientPanel
              order={assignment.order}
              seller={assignment.seller}
              itemDisplay={assignment.itemDisplay}
            />
            {/* Above the outcome form on purpose: the agent needs the
                last conversation BEFORE they dial, not after they have
                opened with the wrong sentence. */}
            <PriorAttempts attempts={assignment.priorAttempts} />

            <div className="grid grid-cols-1 gap-3 mt-4">
              <FormField label="Outcome" required>
                <Select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value as CallOutcome | '')}
                >
                  <option value="">Select an outcome…</option>
                  {OUTCOME_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </FormField>

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
              {assignment.callPurpose.kind !== 'CONFIRMATION' &&
              (outcome === 'CONFIRMED' || outcome === 'CUSTOMER_DECLINED') ? (
                <div className="text-warning -mt-2 text-xs">
                  This parcel has already shipped, so this outcome will not move the order — the
                  call is still recorded and written onto the ticket. To stop the delivery, use
                  &ldquo;Send it back&rdquo; on the order instead.
                </div>
              ) : (
                outcome && (
                  <div className="text-text-faint text-xs -mt-2">
                    {OUTCOME_OPTIONS.find((o) => o.value === outcome)?.helper}
                  </div>
                )
              )}

              {outcome === 'CALLBACK_REQUESTED' && (
                <FormField label="Callback scheduled for" required>
                  <Input
                    type="datetime-local"
                    value={callbackTime}
                    onChange={(e) => setCallbackTime(e.target.value)}
                  />
                </FormField>
              )}

              {/*
                This field is the ANSWER to whatever the seller asked.
                It was labelled "Notes / free-form (audited)", which told
                an agent it was a private scratchpad — so the one thing
                the seller is waiting for was the thing least likely to
                get written.
              */}
              <FormField
                label={hasOpenIssues ? 'What the customer told you' : 'Notes'}
                hint={
                  hasOpenIssues
                    ? 'Written onto the seller’s open issue word for word — this is how they find out what happened.'
                    : 'Free-form, audited.'
                }
              >
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={
                    hasOpenIssues
                      ? 'e.g. Customer will be home after 6pm and asked us to try again tomorrow'
                      : 'Free-form notes (audited)'
                  }
                />
              </FormField>

              {hasOpenIssues ? (
                <label className="text-text-body flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={closeIssues}
                    onChange={(e) => setCloseIssues(e.target.checked)}
                  />
                  <span>
                    Close the seller’s {assignment.openTickets.length === 1 ? 'issue' : 'issues'}{' '}
                    after recording
                    <span className="text-text-muted block text-xs">
                      Tick this when the question is answered. Leave it if you still owe them
                      something — a re-attempt to arrange, or another call.
                    </span>
                  </span>
                </label>
              ) : null}

              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="md"
                  disabled={record.isPending || !outcome}
                  onClick={() => void onRecord()}
                >
                  {record.isPending ? 'Recording…' : 'Record outcome'}
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
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
  itemDisplay,
}: {
  readonly order: CallOrderSnapshot | null;
  readonly seller: PulledAssignment['seller'];
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
      <div className="rounded-[6px] border border-border p-3 text-sm text-text-muted">
        This order could not be loaded. Release the call and tell a supervisor.
      </div>
    );
  }

  // The recipient block is NESTED (`recipient.name`, not
  // `recipientName`). This panel used to cast an `unknown` payload to
  // the flat column names, so every field here rendered "—" and an
  // agent was asked to phone a number the screen would not show.
  const r = order.recipient;

  return (
    <div className="rounded-[6px] border border-border p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-text-bright text-base font-semibold">{order.orderNumber}</span>
        {seller !== null && (
          // The agent opens with this: "calling about your order from
          // <store>". A customer phoned by a company they do not
          // recognise hangs up, and in a COD market that is a refusal.
          <span className="text-text-muted text-sm">
            Ordered from <span className="text-text-bright font-medium">{seller.companyName}</span>
          </span>
        )}
      </div>

      <div className="mb-2">
        <PhoneToCall phone={r.phoneE164} altPhone={r.altPhoneE164} />
      </div>

      {/* text-sm, not text-xs: an agent reads this card for a whole
          shift while talking, and 12px of grey is where a digit or a
          house number gets misread. */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        <Field label="Name" value={r.name || '—'} />
        <Field
          label="Address"
          value={[r.addressLine1, r.addressLine2, r.landmark].filter(Boolean).join(', ') || '—'}
        />
        {/* Surfaced here, not enforced. An agent who learns the pin is
            not deliverable can ask for another address while the
            customer is still on the phone — which is the entire value.
            Blocking the confirmation instead would leave them holding a
            refusal with nowhere to put it. */}
        {serviceability.data?.known === true && !serviceability.data.serviceable && (
          <Field
            label="Delivery"
            value={
              serviceability.data.reason ??
              'Our courier may not deliver to this PIN — ask for an alternative address.'
            }
          />
        )}
        <Field
          label="City / state / PIN"
          // Filtering on EMPTY STRING, not nullishness: city/state are
          // stored as '' for orders whose seller never supplied them
          // (ORD-5). An agent reading "· · 560001" aloud is the failure.
          value={
            [r.city, r.stateProvince, r.postalCode].filter((v) => v.trim() !== '').join(' · ') ||
            '—'
          }
        />
        {seller !== null && (
          <Field
            label="Seller contact"
            // For the questions an agent cannot answer — a substitution,
            // a discount the customer says they were promised. Reaching
            // the shop takes a call, not a support ticket.
            value={`${seller.contactPersonName} · ${seller.phone}`}
          />
        )}
        <Field
          label="Payment"
          value={
            order.paymentMode === 'COD' && order.codAmountInr !== null ? (
              // The agent reads this figure aloud to the customer, so it
              // is grouped the way they expect to hear it: ₹12,34,567.
              <span>
                COD <Money amount={order.codAmountInr} />
              </span>
            ) : (
              order.paymentMode || '—'
            )
          }
        />
      </div>
      {order.items.length > 0 && (
        <div className="border-border mt-3 border-t pt-2 text-sm">
          <div className="text-text-faint mb-1">Items</div>
          <ul className="space-y-0.5">
            {order.items.map((it, idx) => {
              // Live catalogue read, keyed on variant — the snapshot's
              // own imageUrl is a canonical object URL that has resolved
              // for nobody since the bucket went private.
              const display = itemDisplay[it.variantId];
              return (
                <li key={`${it.skuCode}-${idx}`} className="flex items-start gap-3 py-1">
                  <ProductThumb src={display?.thumbnailUrl ?? null} size={44} />
                  <div className="min-w-0">
                    <div>
                      <span className="text-text-bright font-medium">
                        {it.productName}
                        {it.variantLabel ? ` · ${it.variantLabel}` : ''}
                      </span>{' '}
                      <span className="text-text-faint font-mono text-xs">
                        ×{it.quantity} · {it.skuCode}
                      </span>
                    </div>
                    {display?.description !== null && display?.description !== undefined && (
                      // Clamped: a product description can run to
                      // paragraphs, and the agent needs the gist while
                      // the customer is on the line, not an essay
                      // pushing the outcome form off the screen.
                      <p className="text-text-muted mt-0.5 line-clamp-2 text-xs leading-snug">
                        {display.description}
                      </p>
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

/**
 * What happened the last times this order was called.
 *
 * Distinct from "My calls" at the bottom of the page, which is the
 * AGENT's own log across every order — useful for reviewing your shift,
 * useless for the customer in front of you. This is the customer's
 * thread: attempt two should open where attempt one left off.
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

  function Entry({ a }: { readonly a: (typeof attempts)[number] }): ReactElement {
    return (
      <li className="border-border bg-surface-raised rounded-[4px] border p-2.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-text-bright text-sm font-semibold">
            {OUTCOME_OPTIONS.find((o) => o.value === a.outcome)?.label ?? a.outcome}
          </span>
          <span className="text-text-muted text-xs">
            {new Date(a.startedAt).toLocaleString('en-IN', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          {!a.isThisOrder && (
            <span className="text-text-faint font-mono text-xs">on {a.orderNumber}</span>
          )}
          {a.agentEmail !== null && (
            <span className="text-text-faint ml-auto text-xs">{a.agentEmail}</span>
          )}
        </div>
        {a.rescheduledFor !== null && (
          // The promise the customer was given. Breaking it is worse
          // than never having made it.
          <div className="text-pending mt-1 text-sm font-medium">
            Promised callback:{' '}
            {new Date(a.rescheduledFor).toLocaleString('en-IN', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        )}
        {a.notes !== null && a.notes !== '' ? (
          <p className="text-text-body mt-1 text-sm leading-snug">{a.notes}</p>
        ) : (
          // Said out loud rather than left blank: "nobody wrote anything
          // down" and "the notes failed to load" look identical
          // otherwise, and only one of them means stop looking.
          <p className="text-text-faint mt-1 text-xs italic">No notes recorded</p>
        )}
      </li>
    );
  }

  return (
    <div className="border-border rounded-[6px] border p-3">
      <h3 className="text-text-bright mb-2 text-sm font-semibold">
        What this customer was told before
        <span className="text-text-muted ml-2 text-xs font-normal">
          {attempts.length} previous {attempts.length === 1 ? 'call' : 'calls'}
        </span>
      </h3>

      {thisOrder.length > 0 && (
        <ul className="space-y-2">
          {thisOrder.map((a) => (
            <Entry key={a.attemptId} a={a} />
          ))}
        </ul>
      )}

      {earlier.length > 0 && (
        <>
          {/* Kept separate and clearly labelled: a call about a
              different parcel is still context — "she always asks for
              after seven" — but it is not about the one being discussed,
              and an agent must not confuse the two on the phone. */}
          <div className="text-text-faint mt-3 mb-1.5 text-[11px] tracking-wide uppercase">
            Earlier orders by the same customer
          </div>
          <ul className="space-y-2">
            {earlier.map((a) => (
              <Entry key={a.attemptId} a={a} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Field({
  label,
  value,
}: {
  readonly label: string;
  readonly value: ReactNode;
}): ReactElement {
  return (
    <div className="leading-relaxed">
      <span className="text-text-faint">{label}:</span>{' '}
      {/* The VALUE is what gets read aloud, so it carries the weight;
          the label only has to be findable. */}
      <span className="text-text-bright font-medium">{value}</span>
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
  const toast = useToast();
  const transition = useTransitionTicket();
  // FE-2: cosmetic only. The server enforces the permission regardless.
  const canResolve = usePermission('tickets.resolve');

  const close = (ticketId: string): void => {
    void (async () => {
      try {
        await transition.mutateAsync({
          ticketId,
          // Nothing was refunded and nothing came back — the seller
          // asked a question and we answered it. RESOLVED_WRITE_OFF_ACCEPTED
          // is the "settled, no money moved" terminal.
          to: 'RESOLVED_WRITE_OFF_ACCEPTED',
          notes: 'Closed from the call station after speaking to the customer.',
        });
        toast.success('Ticket closed — the seller can see the outcome');
      } catch (err) {
        toast.error(serverVerdict(err));
      }
    })();
  };

  return (
    <div className="border-danger/60 bg-danger/10 mb-3 rounded-lg border-2 p-3">
      <p className="text-danger text-xs font-semibold tracking-wide uppercase">Why this call</p>
      <p className="text-text-bright mt-1 text-sm font-semibold">{purpose.headline}</p>

      {purpose.sellerAsked !== null ? (
        <p className="text-text-body mt-1 text-sm">
          <span className="text-text-muted">They told us: </span>
          &ldquo;{purpose.sellerAsked}&rdquo;
        </p>
      ) : null}

      {tickets.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {tickets.map((t) => (
            <li
              key={t.ticketId}
              className="border-border/60 flex flex-wrap items-start gap-2 rounded border p-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-text-body text-xs">
                  <span className="font-medium">{t.subject}</span>
                  {t.detail === null || t.detail.trim() === '' ? null : (
                    <span className="text-text-muted">: {t.detail}</span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/tickets?ticketId=${t.ticketId}`}
                  className="text-accent text-xs hover:underline"
                >
                  Open
                </Link>
                {canResolve ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={transition.isPending}
                    onClick={() => close(t.ticketId)}
                  >
                    Close
                  </Button>
                ) : null}
              </div>
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
        <p className="text-text-muted mt-2 text-xs">
          Answer these on the call, then record the outcome below — it is written onto the issue and
          can close it in the same step.
        </p>
      ) : null}
    </div>
  );
}
