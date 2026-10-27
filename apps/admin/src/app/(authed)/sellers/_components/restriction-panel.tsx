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
import { useT } from '@/i18n/client';
import { tEn, type MessageKey } from '@/i18n/catalog';
import type { Translate } from '@skydrop/ui/app/i18n';
import { richMessage } from '@/i18n/client';

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
  ['ORDER_CREATE', 'sellersRestrictionPanel.capOrderCreate'],
  ['ORDER_CONFIRM', 'sellersRestrictionPanel.capOrderConfirm'],
  ['CONSIGNMENT_CREATE', 'sellersRestrictionPanel.capConsignmentCreate'],
  ['WITHDRAWAL_REQUEST', 'sellersRestrictionPanel.capWithdrawalRequest'],
] as const;

const IN_FLIGHT = [
  ['SHIPMENT_DISPATCH', 'sellersRestrictionPanel.capShipmentDispatch'],
  // Offered from the change that BUILT the seller tracking page and
  // guarded it in the same commit. It was held back while the page was
  // a placeholder: a checkbox that ticks and stops nothing tells an
  // operator they have blocked something they have not.
  ['TRACKING_VIEW', 'sellersRestrictionPanel.capTrackingView'],
  ['RTO_RECEIVE', 'sellersRestrictionPanel.capRtoReceive'],
] as const;

/**
 * The plain-English name for a capability, for READING a hold back.
 *
 * The dialog that places one has said "Placing new orders" since the
 * day it was written; the card that reports it printed the raw enum, so
 * the screen that SETS a hold spoke English and the screen that reports
 * it spoke database — to the same operator, about the same decision,
 * three inches apart. A hold's whole job is to be understood by the
 * person who has to explain it to a seller on the telephone.
 *
 * Built from the two lists above rather than written out again, so a
 * capability added to either one is named here by construction. An
 * unknown value falls back to the raw code rather than disappearing:
 * a blocked capability nobody can see is worse than an ugly one.
 */
const CAPABILITY_LABELS: Readonly<Record<string, MessageKey>> = Object.fromEntries(
  [...SAFE, ...IN_FLIGHT].map(([key, label]) => [key, label]),
);

export function capabilityLabelIn(tr: Translate<MessageKey>, key: string): string {
  const k = CAPABILITY_LABELS[key];
  return k === undefined ? key : tr(k);
}

export function capabilityLabel(key: string): string {
  return capabilityLabelIn(tEn, key);
}

export function RestrictionPanel({
  sellerId,
  canManage,
}: {
  readonly sellerId: string;
  readonly canManage: boolean;
}): ReactElement {
  const t = useT();

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
      toast.success(t('sellersRestrictionPanel.holdPlacedTheClientSees'));
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
        reason: t('sellersRestrictionPanel.liftedByHandFromClient'),
      });
      toast.success(t('sellersRestrictionPanel.holdLifted'));
    } catch (err) {
      toast.error(serverVerdict(err));
    }
  }

  return (
    <AcCard
      title={t('sellersRestrictionPanel.accountHold')}
      note={t('sellersRestrictionPanel.stopAClientWhoOwes')}
      tone={hold === null ? undefined : 'warn'}
      action={
        canManage && hold === null ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<Lock size={14} />}
            onClick={() => setOpen(true)}
          >
            {t('sellersRestrictionPanel.placeAHold')}
          </Button>
        ) : null
      }
    >
      {hold === null ? (
        <p className="ac-muted">{t('sellersRestrictionPanel.noHoldThisClientCan')}</p>
      ) : (
        <div className="ac-card__body">
          <p className="ac-text">{hold.reason}</p>
          <p className="ac-muted">
            {t('sellersRestrictionPanel.blocked', {
              value: hold.blockedCapabilities.map((c) => capabilityLabelIn(t, c)).join(', '),
            })}
          </p>
          <p className="ac-muted">
            {richMessage(t('sellersRestrictionPanel.balanceLiftsAtStillNeeded'), {
              money: <Money amount={hold.balanceInr} currency="INR" />,
              money2: <Money amount={hold.clearAtBalanceInr} currency="INR" />,
              money3: <Money amount={hold.shortfallInr} currency="INR" />,
            })}
          </p>
          {canManage && (
            <div className="ac-buttons" data-align="start">
              <AsyncButton
                variant="secondary"
                size="sm"
                icon={<LockOpen size={14} />}
                state={lift.isPending ? 'busy' : 'idle'}
                labels={{
                  idle: t('sellersRestrictionPanel.liftNow'),
                  busy: t('sellersRestrictionPanel.lifting'),
                }}
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
        title={t('sellersRestrictionPanel.placeAHold')}
        icon={<Lock size={18} />}
        locked={apply.isPending}
        footer={
          <DialogFooter>
            <Button variant="ghost" size="md" onClick={() => setOpen(false)}>
              {t('sellersRestrictionPanel.cancel')}
            </Button>
            <AsyncButton
              variant="primary"
              size="md"
              state={phaseOf(apply.isPending, error)}
              labels={{
                idle: t('sellersRestrictionPanel.placeHold'),
                busy: t('sellersRestrictionPanel.placing'),
                error: t('sellersRestrictionPanel.notPlaced'),
              }}
              disabled={picked.length === 0 || reason.trim().length < 20 || apply.isPending}
              onClick={() => void submit()}
            />
          </DialogFooter>
        }
      >
        <div className="ac-form">
          <fieldset className="ac-fieldset">
            <legend>{t('sellersRestrictionPanel.stopThemFrom')}</legend>
            {SAFE.map(([key, label]) => (
              <Checkbox
                key={key}
                label={t(label)}
                checked={picked.includes(key)}
                onChange={() => toggle(key)}
              />
            ))}
          </fieldset>

          <fieldset className="ac-fieldset">
            <legend>{t('sellersRestrictionPanel.parcelsAlreadyMoving')}</legend>
            <p className="ac-muted">{t('sellersRestrictionPanel.theseDoNotProtectThe')}</p>
            {IN_FLIGHT.map(([key, label]) => (
              <Checkbox
                key={key}
                label={t(label)}
                checked={picked.includes(key)}
                onChange={() => toggle(key)}
              />
            ))}
          </fieldset>

          {touchesInFlight && (
            <AcCallout tone="warn" icon={<TriangleAlert size={15} />} role="status">
              {t('sellersRestrictionPanel.youHaveChosenSomethingThat')}
            </AcCallout>
          )}

          <TextField
            label={t('sellersRestrictionPanel.liftsAutomaticallyAtBalance')}
            hint={t('sellersRestrictionPanel.usually0ThePointAt')}
            requiredMark
            inputMode="decimal"
            inputClassName="sk-figure"
            value={clearAt}
            onChange={(e) => setClearAt(e.target.value)}
          />

          <TextArea
            label={t('sellersRestrictionPanel.reason')}
            hint={t('sellersRestrictionPanel.theClientReadsThisWrite')}
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
