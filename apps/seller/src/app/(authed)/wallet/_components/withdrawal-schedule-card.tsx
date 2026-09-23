'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Clock, Wallet } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { Switch } from '@skydrop/ui/app/switch';
import { Select } from '@skydrop/ui/app/select';
import { TextField } from '@skydrop/ui/app/text-field';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { useToast } from '@skydrop/ui/app/toast';
import { useWithdrawalSchedule, useSetWithdrawalSchedule } from '@/lib/api-hooks';
import { useSellerIdentity } from '@skydrop/auth/client';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import './wallet.css';

/**
 * The two wallet terms a seller owns.
 *
 * Everything else on this page is what Skydrop charges and allows. These
 * two are different in kind: they decide WHEN we raise a withdrawal request
 * on the seller's behalf, not what they are permitted to take. An
 * automatic request passes the identical guard chain as a manual one
 * (WAL-3) — minimum balance, smallest withdrawal, per-day and per-month caps
 * — so turning it on cannot take money a manual one could not.
 *
 * Editing needs `wallet.withdraw`, not the `wallet.view` that opens the
 * page: changing when money leaves is the same kind of act as asking for
 * it. Without that permission the values still show, read-only, because
 * knowing the schedule is part of understanding the account.
 *
 * Every change — the switch, the hour, the balance to keep — is confirmed
 * on a second screen that restates the new schedule before the SAME save
 * fires (the owner's rule for anything that decides when money leaves).
 */
interface ScheduleChange {
  autoEnabled?: boolean;
  hourLocal?: number;
  keepBalanceInr?: string;
}

function hourText(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

export function WithdrawalScheduleCard(): ReactElement | null {
  const identity = useSellerIdentity();
  const mayEdit = can(identity, 'wallet.withdraw');
  const toast = useToast();
  const schedule = useWithdrawalSchedule();
  const save = useSetWithdrawalSchedule();

  const [hour, setHour] = useState<number | null>(null);
  const [keep, setKeep] = useState<string | null>(null);
  const [pending, setPending] = useState<ScheduleChange | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // Server value wins until the seller touches the field, so a save
  // elsewhere is not overwritten by a stale local number.
  useEffect(() => {
    if (schedule.data && hour === null) setHour(schedule.data.hourLocal);
  }, [schedule.data, hour]);

  if (schedule.data === undefined) return null;
  const data = schedule.data;

  async function apply(body: ScheduleChange): Promise<void> {
    setConfirmError(null);
    try {
      const next = await save.mutateAsync(body);
      setHour(next.hourLocal);
      toast.success(
        next.autoEnabled
          ? `Automatic withdrawals on, at ${String(next.hourLocal).padStart(2, '0')}:00 ${next.timezone}.`
          : 'Automatic withdrawals off. Withdrawals are yours to request.',
      );
    } catch (err) {
      const verdict = serverVerdict(err);
      setConfirmError(verdict);
      toast.error(verdict);
      // Rethrown so the confirm screen stays open with the verdict on it.
      throw err;
    }
  }

  /** What the schedule will be once the pending change is saved. */
  const nextEnabled = pending?.autoEnabled ?? data.autoEnabled;
  const nextHour = pending?.hourLocal ?? data.hourLocal;
  const nextKeep = pending?.keepBalanceInr ?? data.keepBalanceInr;
  const keepIsNumber = Number.isFinite(Number(nextKeep)) && nextKeep.trim() !== '';

  const confirmTitle =
    pending?.autoEnabled === true
      ? 'Turn on automatic withdrawals?'
      : pending?.autoEnabled === false
        ? 'Turn off automatic withdrawals?'
        : pending?.hourLocal !== undefined
          ? 'Change the withdrawal hour?'
          : 'Change the balance to keep?';

  const consequence = nextEnabled
    ? `We raise a withdrawal request for you at ${hourText(nextHour)} (${data.timezone}), leaving the balance to keep in the wallet, and pay it to the bank account on your profile. Each request passes exactly the same checks as one you make by hand.`
    : pending?.autoEnabled === false
      ? 'We stop raising withdrawal requests for you. Withdrawals are yours to request.'
      : `Saved for when automatic withdrawals are on: requests at ${hourText(nextHour)} (${data.timezone}), paid to the bank account on your profile.`;

  return (
    <section className="wal-section">
      <SectionHeading
        title="Withdrawal settings"
        note="Yours to change. Everything below is set by Skydrop."
      />
      <div className="wal-card">
        <div className="wal-settings">
          <div className="wal-setting">
            <div className="wal-setting__text">
              <div className="wal-setting__title" id="wal-auto-title">
                Automatic withdrawals
              </div>
              <p className="wal-setting__desc" id="wal-auto-desc">
                We raise the request for you on a schedule. It passes exactly the same checks as a
                request you make by hand.
              </p>
            </div>
            <div className="wal-setting__control">
              <Switch
                checked={data.autoEnabled}
                disabled={!mayEdit || save.isPending}
                aria-labelledby="wal-auto-title"
                aria-describedby="wal-auto-desc"
                onCheckedChange={(next) => {
                  setConfirmError(null);
                  setPending({ autoEnabled: next });
                }}
              />
            </div>
          </div>

          <div className="wal-setting">
            <div className="wal-setting__text">
              <div className="wal-setting__title">Automatic withdrawal hour</div>
              <p className="wal-setting__desc">
                {/* The zone is stated, never assumed: the sweep reads the
                    hour in the seller's own timezone, so "10:00" means
                    different moments for different sellers. */}
                In your timezone ({data.timezone}).
                {!data.autoEnabled && ' Takes effect when automatic withdrawals are on.'}
              </p>
            </div>
            <div className="wal-setting__control">
              <Select
                className="wal-setting__hour"
                icon={<Clock size={15} />}
                value={hour ?? data.hourLocal}
                disabled={!mayEdit || save.isPending}
                onChange={(e) => setHour(Number(e.target.value))}
                aria-label="Automatic withdrawal hour"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </Select>
              {hour !== null && hour !== data.hourLocal && (
                <Button
                  variant="primary"
                  size="md"
                  disabled={save.isPending}
                  onClick={() => {
                    setConfirmError(null);
                    setPending({ hourLocal: hour });
                  }}
                >
                  Save
                </Button>
              )}
            </div>
          </div>

          {/*
            The seller's own working float, on top of ours.
            Ours is a floor they may never go under — it is the security
            we hold against an unpaid delivery fee. Theirs is a choice:
            a business that wants cash carried between sweeps had no way
            to say so, and the sweep took everything down to our line.
            Applies to the AUTOMATIC withdrawal only; a request they
            make by hand is theirs to size.
          */}
          <div className="wal-setting">
            <div className="wal-setting__text">
              <div className="wal-setting__title">Keep this much in the wallet</div>
              <p className="wal-setting__desc">
                The automatic withdrawal leaves this behind. Must be at least{' '}
                <Money amount={data.platformMinimumInr} currency="INR" convert={false} />, the
                minimum on your account.
              </p>
            </div>
            <div className="wal-setting__control">
              <TextField
                className="wal-setting__keep"
                icon={<Wallet size={15} />}
                value={keep ?? data.keepBalanceInr}
                disabled={!mayEdit || save.isPending}
                onChange={(e) => setKeep(e.target.value)}
                inputMode="decimal"
                inputClassName="sk-figure"
                aria-label="Balance to keep"
              />
              {keep !== null && keep !== data.keepBalanceInr && (
                <Button
                  variant="primary"
                  size="md"
                  disabled={save.isPending}
                  onClick={() => {
                    setConfirmError(null);
                    setPending({ keepBalanceInr: keep.trim() });
                  }}
                >
                  Save
                </Button>
              )}
            </div>
          </div>

          {!mayEdit && (
            <p className="wal-setting__desc">
              Changing these needs the withdrawal permission. Ask an owner or admin on your team.
            </p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) {
            setPending(null);
            setConfirmError(null);
          }
        }}
        title={confirmTitle}
        entity={
          nextEnabled
            ? `Automatic withdrawals on · ${hourText(nextHour)} ${data.timezone}`
            : `Automatic withdrawals off · ${hourText(nextHour)} ${data.timezone}`
        }
        amount={
          nextEnabled || pending?.keepBalanceInr !== undefined ? (
            <span className="wal-stack">
              <span className="wal-faint">Balance to keep</span>
              {keepIsNumber ? (
                <Money amount={nextKeep} currency="INR" convert={false} size="md" />
              ) : (
                nextKeep
              )}
            </span>
          ) : undefined
        }
        consequence={consequence}
        confirmLabel={
          pending?.autoEnabled === true
            ? 'Turn on'
            : pending?.autoEnabled === false
              ? 'Turn off'
              : 'Save'
        }
        onConfirm={() => (pending === null ? undefined : apply(pending))}
        error={confirmError}
      />
    </section>
  );
}
