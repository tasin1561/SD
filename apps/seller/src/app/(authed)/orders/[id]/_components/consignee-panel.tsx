'use client';

import { useState, type ReactElement } from 'react';
import { Info, Send, X } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { TextField } from '@skydrop/ui/app/text-field';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { Notice, OrdSection } from '../../_components/orders-parts';
import { useChangeConsignee, useConsignee, useConsigneeHistory } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { RaiseTicketModal } from '../../../tickets/_components/raise-ticket-modal';

/**
 * Correcting who the parcel is going to, while the courier still allows
 * it.
 *
 * ── WHY THE FIELDS GO GREY RATHER THAN VANISH ────────────────────────
 * A seller looking for "can I fix the phone number" needs to find the
 * answer, and a section that disappears once the parcel is on the van
 * reads as a feature that does not exist. Greyed out with the reason
 * says the thing that is actually true: it exists, and it is too late.
 *
 * ── WHY CITY AND PINCODE ARE SHOWN BUT NOT EDITABLE ──────────────────
 * They are what the parcel was routed on. Hiding them would invite the
 * question; showing them as fixed answers it.
 */
export function ConsigneePanel({
  orderId,
  orderNumber,
  onClose,
}: {
  readonly orderId: string;
  /** Restated when the change is confirmed. */
  readonly orderNumber?: string | undefined;
  /** Put it away again. The Recipient card is what opens it. */
  readonly onClose?: () => void;
}): ReactElement {
  const toast = useToast();
  const info = useConsignee(orderId);
  const history = useConsigneeHistory(orderId);
  const change = useChangeConsignee();

  const [raising, setRaising] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  // A change goes to the courier on the click, so it is confirmed first,
  // restating the order and exactly what moves.
  const [confirming, setConfirming] = useState(false);

  if (info.isLoading)
    return <SkeletonRows rows={3} cols={1} label="Loading the customer details…" />;
  if (info.isError) {
    // An order with no parcel yet is not an error, it is Tuesday: the
    // shipment is provisioned when the order is CONFIRMED, so every
    // order before that point would otherwise show a red failure for
    // being at a perfectly normal stage of its life.
    const code = (info.error as { body?: { code?: string } } | undefined)?.body?.code;
    if (code === 'NO_LIVE_PARCEL') return <div />;
    return <ErrorState message={serverVerdict(info.error)} retry={() => void info.refetch()} />;
  }
  const d = info.data;
  if (d === undefined) return <div />;

  const rows = history.data ?? [];
  // Only what the seller actually typed. An untouched field stays null
  // so it is not sent, rather than being re-sent unchanged.
  const dirty =
    (name !== null && name !== d.currentName) ||
    (phone !== null && phone !== d.currentPhone) ||
    (address !== null && address !== d.currentAddressLine1);

  const send = async (): Promise<void> => {
    try {
      const r = await change.mutateAsync({
        orderId,
        ...(name !== null && name !== d.currentName ? { name } : {}),
        ...(phone !== null && phone !== d.currentPhone ? { phone } : {}),
        ...(address !== null && address !== d.currentAddressLine1 ? { addressLine1: address } : {}),
      });
      setName(null);
      setPhone(null);
      setAddress(null);
      // Sent is not landed. Saying "changed" here would be a claim we
      // have not checked — the portal confirms it within the hour.
      if (r.accepted) {
        toast.success('Sent to the courier. We confirm it on their system shortly.');
      } else {
        toast.error(r.message ?? 'The courier would not take the change.');
      }
    } catch (err) {
      toast.error(serverVerdict(err));
    }
  };

  // What the confirmation restates: only the fields that actually move.
  const changes = [
    name !== null && name !== d.currentName ? `Name: ${d.currentName} → ${name}` : null,
    phone !== null && phone !== d.currentPhone ? `Phone: ${d.currentPhone} → ${phone}` : null,
    address !== null && address !== d.currentAddressLine1
      ? `Address: ${d.currentAddressLine1} → ${address}`
      : null,
  ].filter((x): x is string => x !== null);

  return (
    <OrdSection
      title="Customer details"
      note={
        d.editable ? (
          d.reason
        ) : (
          /*
            When the courier has stopped accepting changes, the reason
            sits behind a chip next to the heading rather than in a
            block that pushed the fields off the screen. The panel is
            READ-ONLY in that state anyway, so the explanation is what
            somebody goes looking for once they notice they cannot type.
          */
          <button
            type="button"
            onClick={() => setWhyOpen((v) => !v)}
            aria-expanded={whyOpen}
            className="ord-lock"
          >
            <Info size={12} aria-hidden />
            Locked by the courier
          </button>
        )
      }
      action={
        onClose !== undefined ? (
          <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={onClose}>
            Close
          </Button>
        ) : undefined
      }
    >
      <div className="ord-stack ord-stack--tight">
        {!d.editable && whyOpen && (
          <Notice
            tone="warn"
            icon={<Info size={16} />}
            title="These can no longer be changed through the courier"
          >
            <span className="ord-p">{d.reason}</span>
            <span className="ord-faint">
              If something here is wrong, tell us and we will take it up with them directly —
              sometimes they can still reach the driver.
            </span>
            <div>
              <Button variant="secondary" size="sm" onClick={() => setRaising(true)}>
                Raise an issue
              </Button>
            </div>
          </Notice>
        )}

        <div className="ord-grid-2">
          <TextField
            id="cons-name"
            label="Name"
            value={name ?? d.currentName}
            disabled={!d.editable}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            id="cons-phone"
            label="Phone"
            value={phone ?? d.currentPhone}
            disabled={!d.editable}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        <TextField
          id="cons-address"
          label="Address"
          hint="The street address only — see below for why the rest cannot move."
          value={address ?? d.currentAddressLine1}
          disabled={!d.editable}
          onChange={(e) => setAddress(e.target.value)}
        />

        <p className="ord-faint">
          {d.city} · {d.stateProvince} · {d.postalCode} — fixed. The parcel is already sorted and
          routed on this pincode, so it cannot be sent somewhere else; only the street address can
          be corrected.
        </p>

        {d.editable ? (
          <div className="ord-row ord-row--end">
            <AsyncButton
              variant="primary"
              size="sm"
              icon={<Send size={14} />}
              state={change.isPending ? 'busy' : undefined}
              labels={{ idle: 'Send to the courier', busy: 'Sending…' }}
              disabled={!dirty || change.isPending}
              onClick={() => setConfirming(true)}
            />
          </div>
        ) : null}

        {rows.length > 0 ? (
          <div>
            <h3 className="ord-h3">Changes made</h3>
            <ol className="ord-log">
              {rows.map((r) => (
                <li key={r.id}>
                  <span className="ord-log__when sk-figure">
                    {new Date(r.createdAt).toLocaleString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {[
                    r.nameBefore !== null ? `name: ${r.nameBefore} → ${r.nameAfter}` : null,
                    r.phoneBefore !== null ? `phone: ${r.phoneBefore} → ${r.phoneAfter}` : null,
                    r.addressBefore !== null
                      ? `address: ${r.addressBefore} → ${r.addressAfter}`
                      : null,
                  ]
                    .filter((x) => x !== null)
                    .join(' · ')}{' '}
                  {r.courierAcceptedAt === null ? (
                    <span className="ord-tone-bad">the courier did not take it</span>
                  ) : r.verifiedAt === null ? (
                    <span className="ord-faint">sent — confirming</span>
                  ) : r.verifiedMatch === true ? (
                    <span className="ord-tone-good">confirmed on their system</span>
                  ) : (
                    <span className="ord-tone-bad">
                      their system still shows the old value — we are on it
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Send this change to the courier?"
        entity={orderNumber ?? 'This order'}
        entityIsIdentifier={orderNumber !== undefined}
        consequence="The courier is asked to update the parcel straight away. It is confirmed on their system within the hour."
        confirmLabel="Send to the courier"
        onConfirm={() => send()}
      >
        <ul className="ord-mini-list">
          {changes.map((c) => (
            <li key={c} className="ord-p">
              {c}
            </li>
          ))}
        </ul>
      </ConfirmDialog>

      {/* The order is already known, so it is not asked for again. */}
      <RaiseTicketModal open={raising} onOpenChange={setRaising} orderId={orderId} />
    </OrdSection>
  );
}
