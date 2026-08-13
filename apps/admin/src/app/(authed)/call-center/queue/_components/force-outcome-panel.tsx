'use client';

import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import { CallOutcome } from '@skydrop/db';
import {
  Button,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Select,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';

/**
 * A supervisor overruling one stuck call (decision 11, force-outcome).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * The queue screen could already move an entry to another agent and
 * close every entry for a seller. Neither resolves ONE order: reassign
 * hands the same stuck call to somebody else, and bulk-dequeue closes
 * the queue entry without recording what happened, so the order never
 * advances. An entry a supervisor already knows the answer to — the
 * customer confirmed on WhatsApp, the number is dead, the seller
 * cancelled by email — had no way out except waiting for an agent to
 * dial a number nobody needs to dial.
 *
 * ── IT IS A REAL ATTEMPT, NOT A SHORTCUT ─────────────────────────────
 * The server routes this through the SAME CallAttemptService as an
 * agent (`forceByAdmin`), so CC-1 through CC-5 all apply: the attempt
 * is appended to the append-only ledger under the SUPERVISOR's staff
 * id, the outcome→transition mapping (CC-2) decides where the order
 * goes, the attempt counts toward the NDR cap if it is one of the six
 * counting outcomes, and the order transition is post-commit. Recording
 * CONFIRMED here reserves stock exactly as it would from the station.
 * That is the point, and it is also why the panel reads as heavy.
 *
 * ── WHAT WE DO NOT PREDICT ───────────────────────────────────────────
 * Where the order lands is the saga's to report, not ours to guess: a
 * CONFIRMED whose reserve fails lands on OUT_OF_STOCK, and an attempt
 * that hits the cap terminates at REJECTED_NDR or pauses at
 * AWAITING_SELLER_DECISION depending on the seller's policy. The toast
 * repeats `finalOrderStatus` back from the response verbatim.
 */
export function ForceOutcomePanel({
  entryId,
  entryStatus,
  orderLabel,
}: {
  readonly entryId: string;
  readonly entryStatus: string;
  /** Order number if the join resolved it, else the raw id — display only. */
  readonly orderLabel: string;
}): ReactElement | null {
  // COSMETIC (FE-2). The queue page opens on `callcenter.queue.view`,
  // which is a strictly weaker permission — without this gate every
  // supervisor who can READ the queue would be offered a button the
  // server refuses. `callcenter.queue.manage` is SUPER_ADMIN-only in
  // the seeded roles today, so for most staff this renders nothing.
  const mayManage = usePermission('callcenter.queue.manage');
  const toast = useToast();
  const force = useForceCallOutcome();

  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<CallOutcome | ''>('');
  const [startedAt, setStartedAt] = useState(localNow());
  const [endedAt, setEndedAt] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!mayManage) return null;
  // The server only forces an outcome on an OPEN entry
  // (ASSIGNMENT_NOT_ACTIVE otherwise). A COMPLETED or EXPIRED entry has
  // already had its say; offering the action there is offering a 409.
  if (entryStatus !== 'PENDING' && entryStatus !== 'ASSIGNED') return null;

  const isCallback = outcome === CallOutcome.CALLBACK_REQUESTED;

  function close(): void {
    setOpen(false);
    setOutcome('');
    setStartedAt(localNow());
    setEndedAt('');
    setScheduledFor('');
    setNotes('');
    setError(null);
    force.reset();
  }

  async function submit(): Promise<void> {
    if (outcome === '') return;
    setError(null);
    try {
      const r = await force.mutateAsync({
        entryId,
        body: {
          outcome,
          startedAt: new Date(startedAt).toISOString(),
          ...(endedAt === '' ? {} : { endedAt: new Date(endedAt).toISOString() }),
          // Sent ONLY for CALLBACK_REQUESTED. The server rejects it on
          // any other outcome (SCHEDULED_FOR_NOT_ALLOWED), so leaving a
          // stale value in state would 400 an otherwise valid overrule.
          ...(isCallback && scheduledFor !== ''
            ? { scheduledFor: new Date(scheduledFor).toISOString() }
            : {}),
          ...(notes.trim() === '' ? {} : { outcomeNotes: notes.trim() }),
        },
      });
      const landed =
        r.finalOrderStatus !== null
          ? `order → ${r.finalOrderStatus}`
          : r.targetStatus !== null
            ? `targeted ${r.targetStatus} — transition did not land, check the order`
            : 'no order transition';
      const cap = r.hitCap ? ' · attempt cap reached' : '';
      const requeue = r.requeued ? ' · re-queued for another call' : '';
      toast.success(`Forced ${r.outcome} · ${landed}${cap}${requeue}`);
      close();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  const startedMissing = startedAt === '';
  // Mirrors the service's own invariant so the operator is told before
  // submitting rather than after (SCHEDULED_FOR_REQUIRED). The BOUNDS
  // on it are settings-driven (min hours / max days) and deliberately
  // not copied here — the server states them in its refusal.
  const callbackMissing = isCallback && scheduledFor === '';

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Force outcome
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={`Overrule this call — ${orderLabel}`}
        description="Recorded as a real attempt against your own name, with the same effect on the order as if an agent had made the call."
        tone="critical"
      >
        <p className="text-text-muted mb-3 text-sm">
          Use this when you already know how the call ended and nobody needs to dial. The attempt is
          permanent, counts toward the customer&apos;s attempt cap where the outcome counts, and
          moves the order — confirming here reserves stock.
        </p>

        {error !== null && <ErrorNote message={error} />}

        <div className="space-y-3">
          <FormField label="Outcome" htmlFor="fo-outcome" required>
            <Select
              id="fo-outcome"
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

          {outcome !== '' && (
            <div className="text-text-faint -mt-2 text-xs">
              {OUTCOME_OPTIONS.find((o) => o.value === outcome)?.helper}
            </div>
          )}

          <FormField
            label="Call started"
            htmlFor="fo-started"
            required
            hint="When the conversation you are recording actually happened. Defaults to now."
          >
            <Input
              id="fo-started"
              type="datetime-local"
              value={startedAt}
              onChange={(e) => setStartedAt(e.target.value)}
            />
          </FormField>

          <FormField
            label="Call ended"
            htmlFor="fo-ended"
            hint="Optional — only used to record how long the call ran."
          >
            <Input
              id="fo-ended"
              type="datetime-local"
              value={endedAt}
              onChange={(e) => setEndedAt(e.target.value)}
            />
          </FormField>

          {isCallback && (
            <FormField
              label="Callback scheduled for"
              htmlFor="fo-callback"
              required
              hint="The order returns to the queue at this time. The server enforces how near and how far it may be."
            >
              <Input
                id="fo-callback"
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
              />
            </FormField>
          )}

          <FormField
            label="Notes"
            htmlFor="fo-notes"
            hint="Say why you overruled this — the attempt ledger is append-only and this is the only place the reason lives."
          >
            <Textarea
              id="fo-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="e.g. Customer confirmed on WhatsApp; agent unavailable to log it."
            />
          </FormField>
        </div>

        <ModalFooter>
          <Button variant="secondary" size="md" onClick={close}>
            Leave it in the queue
          </Button>
          <Button
            variant="destructive"
            size="md"
            disabled={outcome === '' || startedMissing || callbackMissing || force.isPending}
            onClick={() => void submit()}
          >
            {force.isPending ? 'Recording…' : 'Record this outcome'}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}

/**
 * Field names are the server's `RecordCallAttemptDto` verbatim. The API
 * runs `forbidNonWhitelisted`, so one invented key (a "reason" field,
 * say) 400s the whole call — the supervisor's reason goes in
 * `outcomeNotes`, which is where the attempt ledger keeps it.
 */
interface ForceOutcomeBody {
  outcome: CallOutcome;
  startedAt: string;
  endedAt?: string;
  scheduledFor?: string;
  outcomeNotes?: string;
}

interface RecordAttemptResult {
  attemptId: string;
  queueEntryId: string;
  outcome: CallOutcome;
  targetStatus: string | null;
  finalOrderStatus: string | null;
  hitCap: boolean;
  requeued: boolean;
  requeuedAvailableAt: string | null;
}

/**
 * Lives here rather than in `callcenter-hooks.ts` so this feature is one
 * file. Move it there if a second caller appears — a hook with one
 * consumer in a shared module is just a longer import path.
 */
function useForceCallOutcome(): UseMutationResult<
  RecordAttemptResult,
  Error,
  { entryId: string; body: ForceOutcomeBody }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, body }) =>
      client.request<RecordAttemptResult>(`/api/admin/call-queue/${entryId}/force-outcome`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      // The entry closes and the order moves, so both the queue lists
      // and any open order view are now stale.
      void qc.invalidateQueries({ queryKey: ['admin-call-queue'] });
      void qc.invalidateQueries({ queryKey: ['admin-agents'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

const OUTCOME_OPTIONS: ReadonlyArray<{
  value: CallOutcome;
  label: string;
  helper: string;
}> = [
  {
    value: CallOutcome.CONFIRMED,
    label: 'Confirmed',
    helper: 'Customer agreed → reserves stock and advances the order.',
  },
  {
    value: CallOutcome.CUSTOMER_DECLINED,
    label: 'Declined',
    helper: 'Customer no longer wants it → the order is rejected. Terminal.',
  },
  {
    value: CallOutcome.WRONG_NUMBER,
    label: 'Wrong number',
    helper: 'Reached someone else. Counts toward the attempt cap.',
  },
  {
    value: CallOutcome.NO_ANSWER,
    label: 'No answer',
    helper: 'Did not pick up. Counts toward the attempt cap.',
  },
  {
    value: CallOutcome.BUSY,
    label: 'Busy',
    helper: 'Line was busy. Counts toward the attempt cap.',
  },
  {
    value: CallOutcome.VOICEMAIL_LEFT,
    label: 'Voicemail left',
    helper: 'Left a message. Counts toward the attempt cap.',
  },
  {
    value: CallOutcome.CALLBACK_REQUESTED,
    label: 'Callback requested',
    helper: 'Returns to the queue at a time you set. Does not count toward the cap.',
  },
  {
    value: CallOutcome.TECHNICAL_FAILURE,
    label: 'Technical failure',
    helper: 'Line dropped or system fault — no order transition, no cap.',
  },
  {
    value: CallOutcome.LANGUAGE_BARRIER,
    label: 'Language barrier',
    helper: 'Could not communicate — no order transition, no cap.',
  },
];

/**
 * `datetime-local` reads and writes LOCAL wall-clock with no zone, so
 * the value has to be built from local parts. `toISOString()` here would
 * seed the field with UTC and silently backdate the attempt by the
 * operator's offset — five and a half hours, in India.
 */
function localNow(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
