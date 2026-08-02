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
import type { PulledAssignment } from '@skydrop/api-client';
import { usePullNextCall, useRecordCallAttempt, useReleaseCall } from '@/lib/api-hooks';
import { CallOutcome } from '@skydrop/db';
import { MyAvailability } from './my-availability';

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

  const [assignment, setAssignment] = useState<PulledAssignment | null>(null);
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

  const idleRef = useRef(false);
  idleRef.current = isAvailable && assignment === null && !pull.isPending;

  useEffect(() => {
    if (!isAvailable) return;
    if (idleRef.current) void advanceRef.current(false);
    const id = setInterval(() => {
      if (idleRef.current) void advanceRef.current(false);
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
                Order {assignment.orderId} · attempt #{assignment.scheduledAttempts + 1}
              </div>
            </div>

            {/* Above the customer's details, not below them: an agent
                reads top-down with the phone already ringing, and a
                warning under the address is a warning read after the
                call has started. Renders nothing for a first-time
                customer. */}
            <CustomerRiskStrip orderId={assignment.orderId} />
            <RecipientPanel order={assignment.order} />

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
    </div>
  );
}

function RecipientPanel({ order }: { readonly order: unknown }): ReactElement {
  // The order payload is the ResolvedOrder snapshot; we read defensively
  // and only show fields when present (the API may evolve).
  const o = (order ?? {}) as {
    orderNumber?: string;
    recipientName?: string;
    recipientPhoneE164?: string;
    recipientAltPhoneE164?: string | null;
    recipientAddressLine1?: string;
    recipientAddressLine2?: string | null;
    recipientLandmark?: string | null;
    recipientCity?: string;
    recipientStateProvince?: string;
    recipientPostalCode?: string;
    paymentMode?: string;
    codAmountInr?: string | number | null;
    items?: ReadonlyArray<{
      productName: string;
      variantLabel: string | null;
      quantity: number;
      skuCode: string;
    }>;
  };

  return (
    <div className="rounded-[6px] border border-border p-3 text-sm">
      <div className="text-text-bright font-medium mb-1">{o.orderNumber ?? 'Order'}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <Field label="Name" value={o.recipientName ?? '—'} />
        <Field
          label="Phone"
          value={
            o.recipientAltPhoneE164
              ? `${o.recipientPhoneE164 ?? '—'} (alt ${o.recipientAltPhoneE164})`
              : (o.recipientPhoneE164 ?? '—')
          }
        />
        <Field
          label="Address"
          value={
            [o.recipientAddressLine1, o.recipientAddressLine2, o.recipientLandmark]
              .filter(Boolean)
              .join(', ') || '—'
          }
        />
        <Field
          label="City / state / PIN"
          value={`${o.recipientCity ?? '—'} · ${o.recipientStateProvince ?? '—'} · ${o.recipientPostalCode ?? '—'}`}
        />
        <Field
          label="Payment"
          value={
            o.paymentMode === 'COD' && o.codAmountInr != null ? (
              // The agent reads this figure aloud to the customer, so it
              // is grouped the way they expect to hear it: ₹12,34,567.
              <span>
                COD <Money amount={o.codAmountInr} />
              </span>
            ) : (
              (o.paymentMode ?? '—')
            )
          }
        />
      </div>
      {o.items && o.items.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border text-xs">
          <div className="text-text-faint mb-1">Items</div>
          <ul className="space-y-0.5">
            {o.items.map((it, idx) => (
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
