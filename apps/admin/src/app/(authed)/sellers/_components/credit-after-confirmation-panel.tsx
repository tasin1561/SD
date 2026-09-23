'use client';

import Link from 'next/link';
import { useState, type FormEvent, type ReactElement } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useToast } from '@skydrop/ui/app/toast';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Switch } from '@skydrop/ui/app/switch';
import { TextArea } from '@skydrop/ui/app/text-field';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { AcAlert, AcCallout, AcSection, phaseOf } from '../../settings/_components/ac-parts';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useCreditAfterConfirmation,
  useSetCreditAfterConfirmation,
} from '@/lib/reseller-terms-hooks';

/**
 * RS-4 / decision 10 — whether this seller's reseller-store terms may
 * credit a party N days after CONFIRMATION (money fronted before the
 * customer pays). Off by default.
 *
 * On the SELLER page rather than a store page: it is Skydrop agreeing to
 * front money for this seller, and it governs every store they run.
 * Seeing it needs `reseller.stores.view` (or the switch itself); changing
 * it needs `reseller.credit_after_confirmation.enable`. Both cosmetic
 * (FE-2) — the API refuses regardless and its verdict is shown verbatim.
 */
export function CreditAfterConfirmationPanel({
  sellerId,
}: {
  sellerId: string;
}): ReactElement | null {
  const canView = usePermission(
    'reseller.stores.view',
    'reseller.credit_after_confirmation.enable',
  );
  const canSet = usePermission('reseller.credit_after_confirmation.enable');
  const status = useCreditAfterConfirmation(sellerId, canView);
  const set = useSetCreditAfterConfirmation(sellerId);
  const toast = useToast();
  const [target, setTarget] = useState<boolean | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!canView) return null;

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (target === null) return;
    setError(null);
    try {
      const after = await set.mutateAsync({ enabled: target, reason: reason.trim() });
      toast.success(
        after.enabled
          ? 'Credit after confirmation is on for this seller.'
          : after.flaggedStores.length > 0
            ? `Switched off. ${after.flaggedStores.length} store(s) need new terms before they can order.`
            : 'Credit after confirmation is off for this seller.',
      );
      setTarget(null);
      setReason('');
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <AcSection
      title="Reseller stores — credit after confirmation"
      note="Lets this seller's store terms credit a party days after the order is confirmed — before the customer has paid. Off by default."
    >
      {status.isPending ? (
        <SkeletonRows rows={1} cols={2} label="Loading" />
      ) : status.isError ? (
        <ErrorState message={serverVerdict(status.error)} retry={() => void status.refetch()} />
      ) : (
        <div className="ac-card__body">
          <Switch
            checked={status.data.enabled}
            label={status.data.enabled ? 'On for this seller' : 'Off for this seller'}
            disabled={!canSet || set.isPending}
            onCheckedChange={(next) => {
              setError(null);
              setTarget(next);
            }}
          />
          {status.data.source === 'UNREADABLE' ? (
            <p className="ac-danger-text">
              The setting could not be read, so it is treated as off.
            </p>
          ) : null}
          {status.data.flaggedStores.length > 0 ? (
            <AcCallout tone="critical" icon={<TriangleAlert size={15} />}>
              <p className="ac-text">
                These stores’ current terms still use it, so they cannot place new orders until the
                seller publishes new terms:
              </p>
              <ul className="ac-list">
                {status.data.flaggedStores.map((s) => (
                  <li key={s.storeId}>
                    <Link href={`/reseller-stores/${s.storeId}`} className="ac-link">
                      {s.storeName}
                    </Link>{' '}
                    (version {s.version})
                  </li>
                ))}
              </ul>
            </AcCallout>
          ) : null}
        </div>
      )}
      <Dialog
        open={target !== null}
        onOpenChange={(o) => {
          if (!o) setTarget(null);
        }}
        title={
          target === true
            ? 'Allow credit after confirmation?'
            : 'Switch credit after confirmation off?'
        }
        description={
          target === true
            ? 'Skydrop will front money for this seller’s stores before customers pay. Say why.'
            : 'No terms are rewritten: stores whose current terms use it are flagged and cannot order until the seller publishes new terms. Say why.'
        }
        tone="critical"
        icon={<TriangleAlert size={18} />}
        locked={set.isPending}
      >
        <form onSubmit={submit} className="ac-form">
          <TextArea
            label="Why"
            id="cac-reason"
            hint="At least 20 characters. Audited."
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error !== null ? <AcAlert message={error} /> : null}
          <DialogFooter>
            <Button type="button" variant="secondary" size="md" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <AsyncButton
              type="submit"
              variant="destructive"
              size="md"
              state={phaseOf(set.isPending, error)}
              labels={{
                idle: target === true ? 'Switch on' : 'Switch off',
                busy: 'Saving…',
                error: 'Not saved',
              }}
            />
          </DialogFooter>
        </form>
      </Dialog>
    </AcSection>
  );
}
