'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { Eye, KeyRound, PenLine, ShieldAlert, TriangleAlert } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { ChoiceCards } from '@skydrop/ui/app/choice-cards';
import { SegmentedCode } from '@skydrop/ui/app/segmented-code';
import { TextArea } from '@skydrop/ui/app/text-field';
import {
  IMPERSONATION_OTP_LENGTH,
  MIN_IMPERSONATION_REASON,
  type ImpersonationSubjectKind,
  type StartImpersonationResult,
} from '@skydrop/api-client';
import { useStartImpersonation, useVerifyImpersonation } from '@/lib/impersonation-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { AcAlert, AcCallout, phaseOf } from '../../settings/_components/ac-parts';

/**
 * Opening a support session inside somebody's account, in two steps.
 *
 * ── WHY TWO STEPS AND NOT ONE FORM ──────────────────────────────────
 * The reason is typed BEFORE the code is sent, so the sentence is
 * written while the staff member still remembers what they were about to
 * do — not retro-fitted to a session they have already decided to open.
 * The session also exists in the audit trail from step one, so an
 * attempt abandoned at the code is still a thing a reviewer can see.
 * Step two never goes back: a second reason for the same session would
 * make the first one a draft, and the review screen would be reading
 * edited sentences.
 *
 * ── THE REASON FIELD IS THE FEATURE ─────────────────────────────────
 * The review screen is only as useful as these sentences, so the hint
 * asks for WHY rather than WHAT and shows a real example. "Looking at
 * wallet" is what; "checking the payout Rangpur Silk House queried on
 * the 6th" is why, and only the second one answers a reviewer's actual
 * question six weeks later. The twenty-character floor is
 * `MIN_IMPERSONATION_REASON`, the server's own number, checked here as
 * well — this copy is not the enforcement, it is the part that makes the
 * sentence worth keeping, which no server check can do.
 *
 * ── WHAT THIS DOES NOT DECIDE ───────────────────────────────────────
 * Whether the code was right, whether `mayWrite` is allowed, and what a
 * session may touch once it is open are all the server's (FE-2). The
 * act-as card is hidden without `support.impersonate.write` because
 * offering a choice that always refuses is worse than not offering it,
 * and the forbidden list is restated as a WARNING rather than as a
 * prediction — the guard owns that list, and it is already written down
 * once, in `forbidden-while-impersonating.ts`.
 */
export function StartImpersonationDialog({
  subjectKind,
  subjectId,
  subjectName,
  onClose,
}: {
  readonly subjectKind: ImpersonationSubjectKind;
  readonly subjectId: string;
  /** The seller's company name or the store's — said back on every step. */
  readonly subjectName: string;
  readonly onClose: () => void;
}): ReactElement {
  const mayWritePermission = usePermission('support.impersonate.write');
  const start = useStartImpersonation();
  const verify = useVerifyImpersonation();

  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  const [mayWrite, setMayWrite] = useState(false);
  const [opened, setOpened] = useState<StartImpersonationResult | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = reason.trim();
  const tooShort = trimmed.length < MIN_IMPERSONATION_REASON;

  async function onSubmitReason(e: FormEvent): Promise<void> {
    e.preventDefault();
    setReasonTouched(true);
    // Enforced here as well as on the server, deliberately. A refusal
    // after the round trip throws nothing away, but it reads as the
    // system being awkward rather than as a rule somebody chose.
    if (tooShort) return;
    setError(null);
    setBusy(true);
    try {
      setOpened(
        await start.mutateAsync({
          subjectKind,
          subjectId,
          reason: trimmed,
          mayWrite,
        }),
      );
    } catch (err) {
      setError(serverVerdict(err, 'The session could not be opened.'));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitCode(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (opened === null) return;
    setError(null);
    setBusy(true);
    try {
      const result = await verify.mutateAsync({ sessionId: opened.sessionId, code });
      // `redirectUrl` EXACTLY as the server gave it, and a HARD
      // navigation: the token is in the URL's fragment so it never
      // reaches a log, and rebuilding the URL here is the one mistake
      // that would put it in a query string instead. It is also another
      // origin, so a router push could not get there and would leave
      // the console believing it had.
      window.location.assign(result.handoff.redirectUrl);
    } catch (err) {
      setError(serverVerdict(err, 'That code was not accepted.'));
      setBusy(false);
    }
  }

  if (opened === null) {
    return (
      <Dialog
        open
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        title={`Open a support session in ${subjectName}'s account`}
        description="You will see their account exactly as they see it, and everything you do is recorded under both names."
        icon={<ShieldAlert size={18} />}
        size="md"
        tone="critical"
        locked={busy}
      >
        <form onSubmit={(e) => void onSubmitReason(e)} className="ac-form">
          <TextArea
            label="Why are you going in?"
            rows={3}
            value={reason}
            onChange={(e) => {
              setError(null);
              setReason(e.target.value);
            }}
            onBlur={() => setReasonTouched(true)}
            showCount
            maxLength={1000}
            requiredMark
            hint={`Say WHY, not what — a sentence somebody reading this in six weeks can act on. “Checking the payout ${subjectName} queried on the 6th”, not “looking at wallet”. At least ${MIN_IMPERSONATION_REASON} characters.`}
            {...(reasonTouched && tooShort
              ? {
                  error: `${MIN_IMPERSONATION_REASON} characters at the least — ${trimmed.length} so far. This sentence is the whole of what a reviewer will have.`,
                }
              : {})}
          />

          <ChoiceCards
            label="What may you do in there?"
            columns={2}
            value={mayWrite ? 'WRITE' : 'READ_ONLY'}
            onChange={(v) => {
              setError(null);
              setMayWrite(v === 'WRITE');
            }}
            options={[
              {
                value: 'READ_ONLY',
                title: 'Read-only',
                description: 'Look at everything, change nothing. Every write is refused.',
                icon: <Eye size={16} />,
              },
              // Hidden rather than disabled without the permission: a
              // disabled card is a list of what you are not allowed to
              // do, and the server refuses the request anyway (FE-2).
              ...(mayWritePermission
                ? [
                    {
                      value: 'WRITE',
                      title: 'Act as them',
                      description: 'Do things in their account, under their name.',
                      icon: <PenLine size={16} />,
                    },
                  ]
                : []),
            ]}
            hint={
              mayWritePermission
                ? 'Pick read-only unless you already know you will have to change something. A session can be opened again, not widened.'
                : 'Read-only is the only mode you hold. Acting inside somebody’s account needs the separate “Act inside a seller’s or store’s account” permission.'
            }
          />

          {mayWrite && (
            <AcCallout
              tone="critical"
              icon={<TriangleAlert size={15} />}
              role="status"
              title={`Anything you do will look like ${subjectName} did it`}
            >
              <p>
                The audit trail names you as well, but the account’s own history will show their
                name on it. Passwords, their email address, bank details, withdrawals, API keys,
                webhooks, team and roles, and accepting terms stay out of reach whatever you hold —
                the server refuses them and says why.
              </p>
            </AcCallout>
          )}

          {error !== null && <AcAlert message={error} />}

          <DialogFooter>
            <Button type="button" variant="ghost" size="md" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <AsyncButton
              type="submit"
              variant="destructive"
              size="md"
              icon={<KeyRound size={15} />}
              state={phaseOf(busy, error)}
              labels={{ idle: 'Send me a code', busy: 'Opening…', error: 'Not opened' }}
            />
          </DialogFooter>
        </form>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Enter the code to go in"
      description={`The session is recorded against ${subjectName}. It starts the moment the code is accepted.`}
      icon={<KeyRound size={18} />}
      size="sm"
      tone="critical"
      locked={busy}
    >
      <form onSubmit={(e) => void onSubmitCode(e)} className="ac-form">
        <SegmentedCode
          length={IMPERSONATION_OTP_LENGTH}
          label="One-time code"
          charset="numeric"
          autoFocus
          value={code}
          onChange={(next) => {
            setError(null);
            setCode(next);
          }}
          status={error === null ? 'idle' : 'error'}
          // The address is named rather than implied: a staff member
          // with a work address and a personal one otherwise waits at
          // the wrong inbox and concludes the code was never sent.
          hint={`Sent to ${opened.otpSentTo}. It is yours, not theirs.`}
          disabled={busy}
        />

        {error !== null && <AcAlert message={error} />}

        <AcCallout tone="warn" icon={<TriangleAlert size={15} />} role="status">
          <p>
            The next page is {subjectName}’s account, not yours. A red bar across the top will say
            so for as long as the session lasts, and it has the button that ends the session.
          </p>
        </AcCallout>

        <DialogFooter>
          <Button type="button" variant="ghost" size="md" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <AsyncButton
            type="submit"
            variant="destructive"
            size="md"
            icon={<ShieldAlert size={15} />}
            state={phaseOf(busy, error)}
            labels={{
              idle: `Go into ${subjectName}'s account`,
              busy: 'Verifying…',
              error: 'Not accepted',
            }}
          />
        </DialogFooter>
      </form>
    </Dialog>
  );
}
