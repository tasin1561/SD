'use client';

import { useState, type ReactElement } from 'react';
import { Lock, LockOpen, TriangleAlert } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { useToast } from '@skydrop/ui/app/toast';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { AcAlert, AcCallout, AcCard, phaseOf } from '../../settings/_components/ac-parts';
import {
  useApplyRestriction,
  useLiftRestriction,
  useSellerRestriction,
} from '@/lib/restriction-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Capabilities, split by what blocking them actually costs.
 *
 * The safe four are entry points: stop them and the seller starts no new
 * work, while everything already moving carries on. The other three
 * touch parcels in flight — a parcel with the courier still has to be
 * delivered, tracked and returned, so blocking those strands goods we
 * are still paying to move. They are offered because an operator
 * occasionally needs them, and separated here so the choice is made
 * knowingly rather than by ticking the next box down a flat list.
 */
const SAFE = [
  ['ORDER_CREATE', 'Placing new orders'],
  ['ORDER_CONFIRM', 'Confirming orders'],
  ['CONSIGNMENT_CREATE', 'Declaring new inbound stock'],
  ['WITHDRAWAL_REQUEST', 'Requesting withdrawals'],
] as const;

const IN_FLIGHT = [
  ['SHIPMENT_DISPATCH', 'Handing their parcels to the courier'],
  // Offered from the change that BUILT the seller tracking page and
  // guarded it in the same commit. It was held back while the page was
  // a placeholder: a checkbox that ticks and stops nothing tells an
  // operator they have blocked something they have not.
  ['TRACKING_VIEW', 'Seeing where their parcels are'],
  ['RTO_RECEIVE', 'Booking their returns back in'],
] as const;

export function RestrictionPanel({
  sellerId,
  canManage,
}: {
  readonly sellerId: string;
  readonly canManage: boolean;
}): ReactElement {
  const active = useSellerRestriction(sellerId);
  const apply = useApplyRestriction(sellerId);
  const lift = useLiftRestriction(sellerId);
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(['ORDER_CREATE']);
  const [clearAt, setClearAt] = useState('0');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const hold = active.data ?? null;
  const touchesInFlight = picked.some((p) => IN_FLIGHT.some(([k]) => k === p));

  function toggle(key: string): void {
    setPicked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function submit(): Promise<void> {
    setError(null);
    try {
      await apply.mutateAsync({
        capabilities: picked,
        clearAtBalanceInr: clearAt.trim(),
        reason: reason.trim(),
      });
      toast.success('Hold placed. The seller sees it on every page.');
      setOpen(false);
      setReason('');
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  async function onLift(): Promise<void> {
    if (hold === null) return;
    try {
      await lift.mutateAsync({
        restrictionId: hold.id,
        reason: 'Lifted by hand from seller detail',
      });
      toast.success('Hold lifted.');
    } catch (err) {
      toast.error(serverVerdict(err));
    }
  }

  return (
    <AcCard
      title="Account hold"
      note="Stop a seller who owes us money from starting new work. It lifts itself once their balance reaches the figure you set — they never wait for someone to notice a payment."
      tone={hold === null ? undefined : 'warn'}
      action={
        canManage && hold === null ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<Lock size={14} />}
            onClick={() => setOpen(true)}
          >
            Place a hold
          </Button>
        ) : null
      }
    >
      {hold === null ? (
        <p className="ac-muted">No hold. This seller can trade normally.</p>
      ) : (
        <div className="ac-card__body">
          <p className="ac-text">{hold.reason}</p>
          <p className="ac-muted">Blocked: {hold.blockedCapabilities.join(', ')}</p>
          <p className="ac-muted">
            Balance <Money amount={hold.balanceInr} currency="INR" /> · lifts at{' '}
            <Money amount={hold.clearAtBalanceInr} currency="INR" /> · still needed{' '}
            <Money amount={hold.shortfallInr} currency="INR" />
          </p>
          {canManage && (
            <div className="ac-buttons" data-align="start">
              <AsyncButton
                variant="secondary"
                size="sm"
                icon={<LockOpen size={14} />}
                state={lift.isPending ? 'busy' : 'idle'}
                labels={{ idle: 'Lift now', busy: 'Lifting…' }}
                onClick={() => void onLift()}
              />
            </div>
          )}
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="lg"
        title="Place a hold"
        icon={<Lock size={18} />}
        locked={apply.isPending}
        footer={
          <DialogFooter>
            <Button variant="ghost" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <AsyncButton
              variant="primary"
              size="md"
              state={phaseOf(apply.isPending, error)}
              labels={{ idle: 'Place hold', busy: 'Placing…', error: 'Not placed' }}
              disabled={picked.length === 0 || reason.trim().length < 20 || apply.isPending}
              onClick={() => void submit()}
            />
          </DialogFooter>
        }
      >
        <div className="ac-form">
          <fieldset className="ac-fieldset">
            <legend>Stop them from</legend>
            {SAFE.map(([key, label]) => (
              <Checkbox
                key={key}
                label={label}
                checked={picked.includes(key)}
                onChange={() => toggle(key)}
              />
            ))}
          </fieldset>

          <fieldset className="ac-fieldset">
            <legend>Parcels already moving</legend>
            <p className="ac-muted">
              These do not protect the money. A parcel with the courier still has to be delivered,
              tracked and returned, so blocking these strands goods we are still paying to move —
              and a blocked return is a carton on the bench with no record behind it.
            </p>
            {IN_FLIGHT.map(([key, label]) => (
              <Checkbox
                key={key}
                label={label}
                checked={picked.includes(key)}
                onChange={() => toggle(key)}
              />
            ))}
          </fieldset>

          {touchesInFlight && (
            <AcCallout tone="warn" icon={<TriangleAlert size={15} />} role="status">
              You have chosen something that affects parcels already in transit. This is recorded on
              the audit trail as such.
            </AcCallout>
          )}

          <TextField
            label="Lifts automatically at balance (₹)"
            hint="Usually 0 — the point at which they no longer owe us. The seller sees this figure and how far off it they are."
            requiredMark
            inputMode="decimal"
            inputClassName="sk-figure"
            value={clearAt}
            onChange={(e) => setClearAt(e.target.value)}
          />

          <TextArea
            label="Reason"
            hint="The SELLER reads this. Write it as you would say it to them — a hold they cannot understand is one they phone about instead of fixing."
            requiredMark
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />

          {error !== null && <AcAlert message={error} />}
        </div>
      </Dialog>
    </AcCard>
  );
}
