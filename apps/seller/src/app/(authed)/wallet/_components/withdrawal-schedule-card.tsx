'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Button, Card, CardBody, CardHeader, useToast } from '@skydrop/ui/components';
import { useWithdrawalSchedule, useSetWithdrawalSchedule } from '@/lib/api-hooks';
import { useSellerIdentity } from '@skydrop/auth/client';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * The two wallet terms a seller owns.
 *
 * Everything else on this page is what Skydrop charges and allows. These
 * two are different in kind: they decide WHEN we raise a withdrawal request
 * on the seller's behalf, not what they are permitted to take. An
 * automatic request passes the identical guard chain as a manual one
 * (WAL-3) — minimum balance, smallest withdrawal, per-day and per-month caps
 * — so turning it on cannot take money a manual request could not.
 *
 * Editing needs `wallet.withdraw`, not the `wallet.view` that opens the
 * page: changing when money leaves is the same kind of act as asking for
 * it. Without that permission the values still show, read-only, because
 * knowing the schedule is part of understanding the account.
 */
export function WithdrawalScheduleCard(): ReactElement | null {
  const identity = useSellerIdentity();
  const mayEdit = can(identity, 'wallet.withdraw');
  const toast = useToast();
  const schedule = useWithdrawalSchedule();
  const save = useSetWithdrawalSchedule();

  const [hour, setHour] = useState<number | null>(null);
  // Server value wins until the seller touches the field, so a save
  // elsewhere is not overwritten by a stale local number.
  useEffect(() => {
    if (schedule.data && hour === null) setHour(schedule.data.hourLocal);
  }, [schedule.data, hour]);

  if (schedule.data === undefined) return null;
  const data = schedule.data;

  async function apply(body: { autoEnabled?: boolean; hourLocal?: number }): Promise<void> {
    try {
      const next = await save.mutateAsync(body);
      setHour(next.hourLocal);
      toast.success(
        next.autoEnabled
          ? `Automatic withdrawals on, at ${String(next.hourLocal).padStart(2, '0')}:00 ${next.timezone}.`
          : 'Automatic withdrawals off. Withdrawals are yours to request.',
      );
    } catch (err) {
      toast.error(serverVerdict(err));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Withdrawal settings"
        subtitle="Yours to change. Everything below is set by Skydrop."
      />
      <CardBody>
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-text-body text-sm">Automatic withdrawals</div>
              <p className="text-text-faint text-xs">
                We raise the request for you on a schedule. It passes exactly the same checks as a
                request you make by hand.
              </p>
            </div>
            <Button
              variant={data.autoEnabled ? 'secondary' : 'primary'}
              size="md"
              disabled={!mayEdit || save.isPending}
              onClick={() => void apply({ autoEnabled: !data.autoEnabled })}
            >
              {save.isPending ? 'Saving…' : data.autoEnabled ? 'Turn off' : 'Turn on'}
            </Button>
          </div>

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-text-body text-sm">Automatic withdrawal hour</div>
              <p className="text-text-faint text-xs">
                {/* The zone is stated, never assumed: the sweep reads the
                    hour in the seller's own timezone, so "10:00" means
                    different moments for different sellers. */}
                In your timezone ({data.timezone}).
                {!data.autoEnabled && ' Takes effect when automatic withdrawals are on.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                className="sd-field"
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
              </select>
              {hour !== null && hour !== data.hourLocal && (
                <Button
                  variant="primary"
                  size="md"
                  disabled={save.isPending}
                  onClick={() => void apply({ hourLocal: hour })}
                >
                  Save
                </Button>
              )}
            </div>
          </div>

          {!mayEdit && (
            <p className="text-text-faint text-xs">
              Changing these needs the withdrawal permission. Ask an owner or admin on your team.
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
