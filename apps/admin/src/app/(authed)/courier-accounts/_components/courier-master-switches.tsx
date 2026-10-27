'use client';

import { useState, type ReactElement } from 'react';
import { Power } from 'lucide-react';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { TextArea } from '@skydrop/ui/app/text-field';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { useCouriers, useSetCourierActive, type CourierMasterView } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { AfCard } from '@/app/(authed)/system/_components/af-parts';
import './courier-accounts.css';
import { useT } from '@/i18n/client';

/**
 * The master on/off per courier.
 *
 * A level above the accounts below it: an account is one set of
 * credentials at a courier, this is whether we use that courier at all.
 *
 * The copy is deliberate about what OFF does. "Disable" reads like a
 * kill switch, and it is not one — parcels the courier already holds
 * keep being tracked, re-attempted and cancellable, because going quiet
 * on a moving parcel is worse than not booking more of them. Somebody
 * reaching for this at 3am should not have to read the service to
 * find that out.
 *
 * The reason used to be asked with `window.prompt`; it is now a dialog
 * with the same single field and the same request. As before, nothing is
 * checked here — whatever is typed (even nothing) is sent, and the
 * server's verdict is shown verbatim.
 */
export function CourierMasterSwitches(): ReactElement {
  const t = useT();
  const couriers = useCouriers();
  const setActive = useSetCourierActive();
  const canWrite = usePermission('courier.accounts.manage');
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const [asking, setAsking] = useState<CourierMasterView | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function ask(c: CourierMasterView): void {
    setReason('');
    setError(null);
    setAsking(c);
  }

  async function toggle(c: CourierMasterView): Promise<void> {
    const next = !c.isActive;
    setPending(c.code);
    setError(null);
    try {
      const r = await setActive.mutateAsync({ courierCode: c.code, isActive: next, reason });
      const said = r.changed
        ? `${c.name} is now ${r.isActive ? 'taking new parcels' : 'off for new parcels'}.`
        : t('courierAccountsCourierMasterSwitches.wasAlready', {
            name: c.name,
            value: r.isActive
              ? t('courierAccountsCourierMasterSwitches.on')
              : t('courierAccountsCourierMasterSwitches.off'),
          });
      if (r.isActive) toast.success(said);
      else toast.info(said);
    } catch (err) {
      const verdict = serverVerdict(err);
      toast.error(verdict);
      setError(verdict);
      throw err;
    } finally {
      setPending(null);
    }
  }

  const next = asking === null ? true : !asking.isActive;
  const verb = next
    ? t('courierAccountsCourierMasterSwitches.startSendingNewParcelsTo')
    : t('courierAccountsCourierMasterSwitches.stopSendingNewParcelsTo');

  return (
    <AfCard>
      <SectionHeading
        title={t('courierAccountsCourierMasterSwitches.couriers')}
        note={t('courierAccountsCourierMasterSwitches.whetherEachCourierReceivesNew')}
      />
      {couriers.isPending ? (
        <SkeletonRows
          rows={2}
          cols={3}
          label={t('courierAccountsCourierMasterSwitches.loadingCouriers')}
        />
      ) : couriers.isError ? (
        <ErrorState message={serverVerdict(couriers.error)} retry={() => void couriers.refetch()} />
      ) : (couriers.data ?? []).length === 0 ? (
        <p className="af-faint">
          {t('courierAccountsCourierMasterSwitches.noCouriersAreConfigured')}
        </p>
      ) : (
        <ul className="af-list af-stack">
          {(couriers.data ?? []).map((c) => (
            <li key={c.code} className="ca-switch">
              <span className="ca-switch__name">
                <Power size={14} aria-hidden />
                <span className="ca-switch__text">
                  <span className="ca-switch__title">{c.name}</span>
                  <span className="af-faint sk-ident">{c.code}</span>
                </span>
              </span>
              <span className="ca-switch__side">
                <StatusChip
                  kind={c.isActive ? 'delivered' : 'cancelled'}
                  label={
                    c.isActive
                      ? t('courierAccountsCourierMasterSwitches.takingParcels')
                      : t('courierAccountsCourierMasterSwitches.offForNewParcels')
                  }
                />
                {canWrite ? (
                  <Button
                    variant={c.isActive ? 'secondary' : 'primary'}
                    onClick={() => ask(c)}
                    disabled={pending !== null}
                    loading={pending === c.code}
                  >
                    {c.isActive
                      ? t('courierAccountsCourierMasterSwitches.turnOff')
                      : t('courierAccountsCourierMasterSwitches.turnOn')}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(o) => {
          if (!o) setAsking(null);
        }}
        title={
          asking === null
            ? t('courierAccountsCourierMasterSwitches.changeThisCourier')
            : t('courierAccountsCourierMasterSwitches.why', { verb, name: asking.name })
        }
        entity={asking === null ? '' : `${asking.name} (${asking.code})`}
        consequence={
          next
            ? t('courierAccountsCourierMasterSwitches.newOrdersWillBeginRouting')
            : t('courierAccountsCourierMasterSwitches.parcelsTheyAlreadyHoldKeep')
        }
        confirmLabel={
          next
            ? t('courierAccountsCourierMasterSwitches.turnOn')
            : t('courierAccountsCourierMasterSwitches.turnOff')
        }
        destructive={!next}
        error={error}
        onConfirm={() => (asking === null ? undefined : toggle(asking))}
      >
        <TextArea
          label={t('courierAccountsCourierMasterSwitches.reason')}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </ConfirmDialog>
    </AfCard>
  );
}
