'use client';

import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import { CallOutcome } from '@skydrop/db';
import { Gavel } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { TextArea } from '@skydrop/ui/app/text-field';
import { DateField } from '@skydrop/ui/app/date-field';
import { useToast } from '@skydrop/ui/app/toast';
import { Notice } from '../../../orders/_components/order-ops-parts';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

/**
 * A supervisor overruling one stuck call (decision 11, force-outcome).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * The queue screen could already move an entry to another agent, and
 * seller detail can close every open entry for a seller. Neither
 * resolves ONE order: reassign hands the same stuck call to somebody
 * else, and bulk-dequeue closes the queue entry without recording what
 * happened, so the order never advances. An entry a supervisor already knows the answer to — the
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
  const t = useT();
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
          ? t('callCenterQueueForceOutcomePanel.order', { finalOrderStatus: r.finalOrderStatus })
          : r.targetStatus !== null
            ? t('callCenterQueueForceOutcomePanel.targetedTransitionDidNotLand', {
                targetStatus: r.targetStatus,
              })
            : t('callCenterQueueForceOutcomePanel.noOrderTransition');
      const cap = r.hitCap ? t('callCenterQueueForceOutcomePanel.attemptCapReached') : '';
      const requeue = r.requeued
        ? t('callCenterQueueForceOutcomePanel.reQueuedForAnotherCall')
        : '';
      toast.success(
        t('callCenterQueueForceOutcomePanel.forced', { outcome: r.outcome, landed, cap, requeue }),
      );
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
        {t('callCenterQueueForceOutcomePanel.forceOutcome')}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={t('callCenterQueueForceOutcomePanel.overruleThisCall', { orderLabel })}
        description={t('callCenterQueueForceOutcomePanel.recordedAsARealAttempt')}
        tone="critical"
        icon={<Gavel size={18} />}
        size="md"
        footer={
          <DialogFooter>
            <Button variant="secondary" size="md" onClick={close}>
              {t('callCenterQueueForceOutcomePanel.leaveItInTheQueue')}
            </Button>
            <AsyncButton
              variant="destructive"
              size="md"
              state={force.isPending ? 'busy' : 'idle'}
              labels={{
                idle: t('callCenterQueueForceOutcomePanel.recordThisOutcome'),
                busy: t('callCenterQueueForceOutcomePanel.recording'),
              }}
              disabled={outcome === '' || startedMissing || callbackMissing || force.isPending}
              onClick={() => void submit()}
            />
          </DialogFooter>
        }
      >
        <div className="oo-stack">
          <p className="oo-p">{t('callCenterQueueForceOutcomePanel.useThisWhenYouAlready')}</p>

          {error !== null && (
            <Notice tone="bad" role="alert">
              <p className="oo-error">{error}</p>
            </Notice>
          )}

          <Select
            id="fo-outcome"
            label={t('callCenterQueueForceOutcomePanel.outcome')}
            requiredMark
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as CallOutcome | '')}
          >
            <option value="">{t('callCenterQueueForceOutcomePanel.selectAnOutcome')}</option>
            {OUTCOME_OPTIONS(t).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>

          {outcome !== '' && (
            <p className="oo-faint">
              {OUTCOME_OPTIONS(t).find((o) => o.value === outcome)?.helper}
            </p>
          )}

          <DateField
            id="fo-started"
            type="datetime-local"
            label={t('callCenterQueueForceOutcomePanel.callStarted')}
            requiredMark
            hint={t('callCenterQueueForceOutcomePanel.whenTheConversationYouAre')}
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
          />

          <DateField
            id="fo-ended"
            type="datetime-local"
            label={t('callCenterQueueForceOutcomePanel.callEnded')}
            hint={t('callCenterQueueForceOutcomePanel.optionalOnlyUsedToRecord')}
            value={endedAt}
            onChange={(e) => setEndedAt(e.target.value)}
          />

          {isCallback && (
            <DateField
              id="fo-callback"
              type="datetime-local"
              label={t('callCenterQueueForceOutcomePanel.callbackScheduledFor')}
              requiredMark
              hint={t('callCenterQueueForceOutcomePanel.theOrderReturnsToThe')}
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
            />
          )}

          <TextArea
            id="fo-notes"
            label={t('callCenterQueueForceOutcomePanel.notes')}
            hint={t('callCenterQueueForceOutcomePanel.sayWhyYouOverruledThis')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
            showCount
            rows={3}
            placeholder={t('callCenterQueueForceOutcomePanel.eGCustomerConfirmedOn')}
          />
        </div>
      </Dialog>
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

const OUTCOME_OPTIONS = (
  t: Translate<MessageKey>,
): ReadonlyArray<{
  value: CallOutcome;
  label: string;
  helper: string;
}> => [
  {
    value: CallOutcome.CONFIRMED,
    label: t('callCenterQueueForceOutcomePanel.confirmed'),
    helper: t('callCenterQueueForceOutcomePanel.customerAgreedReservesStockAnd'),
  },
  {
    value: CallOutcome.CUSTOMER_DECLINED,
    label: t('callCenterQueueForceOutcomePanel.declined'),
    helper: t('callCenterQueueForceOutcomePanel.customerNoLongerWantsIt'),
  },
  {
    value: CallOutcome.WRONG_NUMBER,
    label: t('callCenterQueueForceOutcomePanel.wrongNumber'),
    helper: t('callCenterQueueForceOutcomePanel.reachedSomeoneElseCountsToward'),
  },
  {
    value: CallOutcome.NO_ANSWER,
    label: t('callCenterQueueForceOutcomePanel.noAnswer'),
    helper: t('callCenterQueueForceOutcomePanel.didNotPickUpCounts'),
  },
  {
    value: CallOutcome.BUSY,
    label: t('callCenterQueueForceOutcomePanel.busy'),
    helper: t('callCenterQueueForceOutcomePanel.lineWasBusyCountsToward'),
  },
  {
    value: CallOutcome.VOICEMAIL_LEFT,
    label: t('callCenterQueueForceOutcomePanel.voicemailLeft'),
    helper: t('callCenterQueueForceOutcomePanel.leftAMessageCountsToward'),
  },
  {
    value: CallOutcome.CALLBACK_REQUESTED,
    label: t('callCenterQueueForceOutcomePanel.callbackRequested'),
    helper: t('callCenterQueueForceOutcomePanel.returnsToTheQueueAt'),
  },
  {
    value: CallOutcome.TECHNICAL_FAILURE,
    label: t('callCenterQueueForceOutcomePanel.technicalFailure'),
    helper: t('callCenterQueueForceOutcomePanel.lineDroppedOrSystemFault'),
  },
  {
    value: CallOutcome.LANGUAGE_BARRIER,
    label: t('callCenterQueueForceOutcomePanel.languageBarrier'),
    helper: t('callCenterQueueForceOutcomePanel.couldNotCommunicateNoOrder'),
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
