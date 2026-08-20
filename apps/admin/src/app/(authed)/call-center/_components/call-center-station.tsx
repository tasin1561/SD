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
import {
  usePullNextCall,
  useRecordCallAttempt,
  useReleaseCall,
  useCurrentCalls,
} from '@/lib/api-hooks';
import { CallOutcome } from '@skydrop/db';
import { MyAvailability } from './my-availability';
import { MyCallHistory } from './my-call-history';

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
  /** Whether the held-call check has answered — the auto-advance must
   *  not pull before it has, or the first tick races it to a certain
   *  AGENT_AT_CAPACITY. */
  const [bootstrapped, setBootstrapped] = useState(false);
  /** Last look found nothing — drives the copy, not the schedule. */
  const [queueEmpty, setQueueEmpty] = useState(false);
  const [outcome, setOutcome] = useState<CallOutcome | ''>('');
  const [notes, setNotes] = useState('');
  const [callbackTime, setCallbackTime] = useState('');
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
      const tail =
        r.finalOrderStatus !== null ? `order → ${r.finalOrderStatus}` : 'no order transition';
      toast.success(`Recorded ${r.outcome} · ${tail}`);
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
            <CustomerRiskStrip orderId={assignment.orderId} />
            <RecipientPanel order={assignment.order} seller={assignment.seller} />

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

              {outcome && (
                <div className="text-text-faint text-xs -mt-2">
                  {OUTCOME_OPTIONS.find((o) => o.value === outcome)?.helper}
                </div>
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

              <FormField label="Notes">
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Free-form notes (audited)"
                />
              </FormField>

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
}: {
  readonly order: CallOrderSnapshot | null;
  readonly seller: PulledAssignment['seller'];
}): ReactElement {
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
        <span className="text-text-bright font-medium">{order.orderNumber}</span>
        {seller !== null && (
          // The agent opens with this: "calling about your order from
          // <store>". A customer phoned by a company they do not
          // recognise hangs up, and in a COD market that is a refusal.
          <span className="text-text-muted text-xs">
            Ordered from <span className="text-text-bright">{seller.companyName}</span>
          </span>
        )}
      </div>

      <div className="mb-2">
        <PhoneToCall phone={r.phoneE164} altPhone={r.altPhoneE164} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <Field label="Name" value={r.name || '—'} />
        <Field
          label="Address"
          value={[r.addressLine1, r.addressLine2, r.landmark].filter(Boolean).join(', ') || '—'}
        />
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
        <div className="mt-2 pt-2 border-t border-border text-xs">
          <div className="text-text-faint mb-1">Items</div>
          <ul className="space-y-0.5">
            {order.items.map((it, idx) => (
              <li key={`${it.skuCode}-${idx}`}>
                <span className="text-text-bright">
                  {it.productName}
                  {it.variantLabel ? ` · ${it.variantLabel}` : ''}
                </span>{' '}
                <span className="text-text-faint font-mono">
                  ×{it.quantity} · {it.skuCode}
                </span>
              </li>
            ))}
          </ul>
        </div>
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
    <div>
      <span className="text-text-faint">{label}:</span>{' '}
      <span className="text-text-body">{value}</span>
    </div>
  );
}
