'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Money,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
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
    <Card>
      <CardHeader
        title="Account hold"
        subtitle="Stop a seller who owes us money from starting new work. It lifts itself once their balance reaches the figure you set — they never wait for someone to notice a payment."
        action={
          canManage && hold === null ? (
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
              Place a hold
            </Button>
          ) : null
        }
      />
      <CardBody>
        {hold === null ? (
          <p className="text-text-muted text-sm">No hold. This seller can trade normally.</p>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="text-text-body">{hold.reason}</p>
            <p className="text-text-muted text-xs">
              Blocked: {hold.blockedCapabilities.join(', ')}
            </p>
            <p className="text-text-muted text-xs">
              Balance <Money amount={hold.balanceInr} currency="INR" /> · lifts at{' '}
              <Money amount={hold.clearAtBalanceInr} currency="INR" /> · still needed{' '}
              <Money amount={hold.shortfallInr} currency="INR" />
            </p>
            {canManage && (
              <Button
                variant="secondary"
                size="sm"
                disabled={lift.isPending}
                onClick={() => void onLift()}
              >
                {lift.isPending ? 'Lifting…' : 'Lift now'}
              </Button>
            )}
          </div>
        )}
      </CardBody>

      <Modal open={open} onOpenChange={setOpen} size="lg" title="Place a hold">
        <div className="space-y-3">
          <div>
            <p className="text-text-secondary mb-1 text-sm font-medium">Stop them from</p>
            <div className="space-y-1">
              {SAFE.map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={picked.includes(key)}
                    onChange={() => toggle(key)}
                  />
                  <span className="text-text-body">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-text-secondary mb-1 text-sm font-medium">Parcels already moving</p>
            <p className="text-text-muted mb-1 text-xs">
              These do not protect the money. A parcel with the courier still has to be delivered,
              tracked and returned, so blocking these strands goods we are still paying to move —
              and a blocked return is a carton on the bench with no record behind it.
            </p>
            <div className="space-y-1">
              {IN_FLIGHT.map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={picked.includes(key)}
                    onChange={() => toggle(key)}
                  />
                  <span className="text-text-body">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {touchesInFlight && (
            <div className="border-[var(--color-warning-ring)] bg-[var(--color-warning-tint)] text-text-body rounded-md border px-3 py-2 text-xs">
              You have chosen something that affects parcels already in transit. This is recorded on
              the audit trail as such.
            </div>
          )}

          <FormField
            label="Lifts automatically at balance (₹)"
            hint="Usually 0 — the point at which they no longer owe us. The seller sees this figure and how far off it they are."
            required
          >
            <Input
              className="max-w-none"
              inputMode="decimal"
              value={clearAt}
              onChange={(e) => setClearAt(e.target.value)}
            />
          </FormField>

          <FormField
            label="Reason"
            hint="The SELLER reads this. Write it as you would say it to them — a hold they cannot understand is one they phone about instead of fixing."
            required
          >
            <Textarea
              className="max-w-none"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>

          {error !== null && <ErrorNote message={error} />}
        </div>

        <ModalFooter>
          <Button variant="ghost" size="md" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={picked.length === 0 || reason.trim().length < 20 || apply.isPending}
            onClick={() => void submit()}
          >
            {apply.isPending ? 'Placing…' : 'Place hold'}
          </Button>
        </ModalFooter>
      </Modal>
    </Card>
  );
}
