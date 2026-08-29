'use client';

import { useState, type ReactElement } from 'react';
import { Power } from 'lucide-react';
import {
  Button,
  Card,
  ErrorNote,
  SkeletonRows,
  StatusBadge,
  useToast,
} from '@skydrop/ui/components';
import { useCouriers, useSetCourierActive, type CourierMasterView } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';

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
 */
export function CourierMasterSwitches(): ReactElement {
  const couriers = useCouriers();
  const setActive = useSetCourierActive();
  const canWrite = usePermission('courier.accounts.manage');
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);

  function toggle(c: CourierMasterView): void {
    const next = !c.isActive;
    const verb = next ? 'start sending new parcels to' : 'stop sending new parcels to';
    const reason = window.prompt(
      `Why ${verb} ${c.name}?\n\n` +
        (next
          ? 'New orders will begin routing here immediately.'
          : 'Parcels they already hold keep being tracked and can still be cancelled or re-attempted. Only new bookings stop.'),
      '',
    );
    // Cancelled the prompt: do nothing at all, rather than sending a
    // blank reason the server would reject anyway.
    if (reason === null) return;

    setPending(c.code);
    setActive.mutate(
      { courierCode: c.code, isActive: next, reason },
      {
        onSuccess: (r) => {
          const said = r.changed
            ? `${c.name} is now ${r.isActive ? 'taking new parcels' : 'off for new parcels'}.`
            : `${c.name} was already ${r.isActive ? 'on' : 'off'}.`;
          if (r.isActive) toast.success(said);
          else toast.info(said);
          setPending(null);
        },
        onError: (err) => {
          toast.error(serverVerdict(err));
          setPending(null);
        },
      },
    );
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold">Couriers</h2>
      <p className="text-text-muted mb-3 text-xs leading-relaxed">
        Whether each courier receives new parcels. Turning one off diverts new orders to the others;
        parcels already with them keep being tracked, and can still be cancelled or re-attempted.
      </p>
      {couriers.isPending ? (
        <SkeletonRows rows={2} />
      ) : couriers.isError ? (
        <ErrorNote message={serverVerdict(couriers.error)} retry={() => void couriers.refetch()} />
      ) : (couriers.data ?? []).length === 0 ? (
        <p className="text-sm text-text-faint">No couriers are configured.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(couriers.data ?? []).map((c) => (
            <li
              key={c.code}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Power size={14} aria-hidden className="shrink-0 text-text-faint" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{c.name}</span>
                  <span className="block font-mono text-xs text-text-faint">{c.code}</span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <StatusBadge
                  kind={c.isActive ? 'delivered' : 'cancelled'}
                  label={c.isActive ? 'Taking parcels' : 'Off for new parcels'}
                />
                {canWrite ? (
                  <Button
                    variant={c.isActive ? 'secondary' : 'primary'}
                    onClick={() => toggle(c)}
                    disabled={pending !== null}
                  >
                    {pending === c.code ? 'Saving…' : c.isActive ? 'Turn off' : 'Turn on'}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
