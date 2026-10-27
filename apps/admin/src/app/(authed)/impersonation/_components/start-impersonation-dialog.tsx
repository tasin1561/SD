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
import { useT } from '@/i18n/client';

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
  const t = useT();
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
      setError(serverVerdict(err, t('impersonationStartImpersonationDialog.theSessionCouldNotBe')));
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
      setError(
        serverVerdict(err, t('impersonationStartImpersonationDialog.thatCodeWasNotAccepted')),
      );
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
        title={t('impersonationStartImpersonationDialog.openASupportSessionIn', { subjectName })}
        description={t('impersonationStartImpersonationDialog.youWillSeeTheirAccount')}
        icon={<ShieldAlert size={18} />}
        size="md"
        tone="critical"
        locked={busy}
      >
        <form onSubmit={(e) => void onSubmitReason(e)} className="ac-form">
          <TextArea
            label={t('impersonationStartImpersonationDialog.whyAreYouGoingIn')}
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
            hint={t('impersonationStartImpersonationDialog.sayWhyNotWhatA', {
              subjectName,
              minImpersonationReason: MIN_IMPERSONATION_REASON,
            })}
            {...(reasonTouched && tooShort
              ? {
                  error: t('impersonationStartImpersonationDialog.charactersAtTheLeastSo', {
                    minImpersonationReason: MIN_IMPERSONATION_REASON,
                    length: trimmed.length,
                  }),
                }
              : {})}
          />

          <ChoiceCards
            label={t('impersonationStartImpersonationDialog.whatMayYouDoIn')}
            columns={2}
            value={mayWrite ? 'WRITE' : 'READ_ONLY'}
            onChange={(v) => {
              setError(null);
              setMayWrite(v === 'WRITE');
            }}
            options={[
              {
                value: 'READ_ONLY',
                title: t('impersonationStartImpersonationDialog.readOnly'),
                description: t(
                  'impersonationStartImpersonationDialog.lookAtEverythingChangeNothing',
                ),
                icon: <Eye size={16} />,
              },
              // Hidden rather than disabled without the permission: a
              // disabled card is a list of what you are not allowed to
              // do, and the server refuses the request anyway (FE-2).
              ...(mayWritePermission
                ? [
                    {
                      value: 'WRITE',
                      title: t('impersonationStartImpersonationDialog.actAsThem'),
                      description: t(
                        'impersonationStartImpersonationDialog.doThingsInTheirAccount',
                      ),
                      icon: <PenLine size={16} />,
                    },
                  ]
                : []),
            ]}
            hint={
              mayWritePermission
                ? t('impersonationStartImpersonationDialog.pickReadOnlyUnlessYou')
                : t('impersonationStartImpersonationDialog.readOnlyIsTheOnly')
            }
          />

          {mayWrite && (
            <AcCallout
              tone="critical"
              icon={<TriangleAlert size={15} />}
              role="status"
              title={t('impersonationStartImpersonationDialog.anythingYouDoWillLook', {
                subjectName,
              })}
            >
              <p>{t('impersonationStartImpersonationDialog.theAuditTrailNamesYou')}</p>
            </AcCallout>
          )}

          {error !== null && <AcAlert message={error} />}

          <DialogFooter>
            <Button type="button" variant="ghost" size="md" disabled={busy} onClick={onClose}>
              {t('impersonationStartImpersonationDialog.cancel')}
            </Button>
            <AsyncButton
              type="submit"
              variant="destructive"
              size="md"
              icon={<KeyRound size={15} />}
              state={phaseOf(busy, error)}
              labels={{
                idle: t('impersonationStartImpersonationDialog.sendMeACode'),
                busy: t('impersonationStartImpersonationDialog.opening'),
                error: t('impersonationStartImpersonationDialog.notOpened'),
              }}
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
      title={t('impersonationStartImpersonationDialog.enterTheCodeToGo')}
      description={t('impersonationStartImpersonationDialog.theSessionIsRecordedAgainst', {
        subjectName,
      })}
      icon={<KeyRound size={18} />}
      size="sm"
      tone="critical"
      locked={busy}
    >
      <form onSubmit={(e) => void onSubmitCode(e)} className="ac-form">
        <SegmentedCode
          length={IMPERSONATION_OTP_LENGTH}
          label={t('impersonationStartImpersonationDialog.oneTimeCode')}
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
          hint={t('impersonationStartImpersonationDialog.sentToItIsYours', {
            otpSentTo: opened.otpSentTo,
          })}
          disabled={busy}
        />

        {error !== null && <AcAlert message={error} />}

        <AcCallout tone="warn" icon={<TriangleAlert size={15} />} role="status">
          <p>{t('impersonationStartImpersonationDialog.theNextPageIsS', { subjectName })}</p>
        </AcCallout>

        <DialogFooter>
          <Button type="button" variant="ghost" size="md" disabled={busy} onClick={onClose}>
            {t('impersonationStartImpersonationDialog.cancel')}
          </Button>
          <AsyncButton
            type="submit"
            variant="destructive"
            size="md"
            icon={<ShieldAlert size={15} />}
            state={phaseOf(busy, error)}
            labels={{
              idle: t('impersonationStartImpersonationDialog.goIntoSAccount', { subjectName }),
              busy: t('impersonationStartImpersonationDialog.verifying'),
              error: t('impersonationStartImpersonationDialog.notAccepted'),
            }}
          />
        </DialogFooter>
      </form>
    </Dialog>
  );
}
