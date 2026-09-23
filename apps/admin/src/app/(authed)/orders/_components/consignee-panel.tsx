'use client';

import { useState, type ReactElement } from 'react';
import { TriangleAlert, UserRound } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { TextField } from '@skydrop/ui/app/text-field';
import { Timeline, type TimelineStep } from '@skydrop/ui/app/timeline';
import { useToast } from '@skydrop/ui/app/toast';
import { useChangeConsignee, useConsignee, useConsigneeHistory } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { Notice, OoSection } from './order-ops-parts';
import './order-shipping.css';

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
export function ConsigneePanel({ orderId }: { readonly orderId: string }): ReactElement {
  const toast = useToast();
  const info = useConsignee(orderId);
  const history = useConsigneeHistory(orderId);
  const change = useChangeConsignee();
  // The order page is open to `orders.view`, which is a wider audience
  // than the courier surface. Not offering the control to someone who
  // may not use it, rather than letting them fill it in and collect a
  // 403 — the server still enforces it either way (FE-2).
  const canWrite = usePermission('courier.ops.write');

  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);

  if (info.isLoading) return <SkeletonRows rows={3} cols={1} />;
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

  // The request and its outcome, unchanged; returned as a promise so the
  // button's rolling label follows the real request. A refusal is
  // re-thrown after its toast so the button shows the error state too.
  const submit = async (): Promise<void> => {
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
        throw new Error('not accepted');
      }
    } catch (err) {
      if (!(err instanceof Error && err.message === 'not accepted')) {
        toast.error(serverVerdict(err));
      }
      throw err;
    }
  };

  const steps: TimelineStep[] = rows.map((r) => {
    const failed =
      r.courierAcceptedAt === null || (r.verifiedAt !== null && r.verifiedMatch !== true);
    return {
      id: r.id,
      state: r.courierAcceptedAt !== null && r.verifiedAt === null ? 'current' : 'done',
      tone: failed ? 'failed' : 'default',
      time: (
        <span className="sk-figure">
          {new Date(r.createdAt).toLocaleString('en-IN', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      ),
      label: [
        r.nameBefore !== null ? `name: ${r.nameBefore} → ${r.nameAfter}` : null,
        r.phoneBefore !== null ? `phone: ${r.phoneBefore} → ${r.phoneAfter}` : null,
        r.addressBefore !== null ? `address: ${r.addressBefore} → ${r.addressAfter}` : null,
      ]
        .filter((x) => x !== null)
        .join(' · '),
      description:
        r.courierAcceptedAt === null ? (
          <span className="oo-bad">the courier did not take it</span>
        ) : r.verifiedAt === null ? (
          <span className="oo-muted">sent — confirming</span>
        ) : r.verifiedMatch === true ? (
          <span className="oo-good">confirmed on their system</span>
        ) : (
          <span className="oo-bad">their system still shows the old value — we are on it</span>
        ),
    };
  });

  return (
    <OoSection title="Customer details" note={d.editable ? d.reason : undefined}>
      {/*
        The same warning the seller gets, without their raise-an-issue
        button: an operator's route to the courier is the escalation
        on the ticket, which is somewhere else and already built.
      */}
      {!d.editable && (
        <Notice
          tone="warn"
          icon={<TriangleAlert size={16} />}
          title="These can no longer be changed through the courier"
        >
          <p>{d.reason}</p>
          <p className="oo-faint">
            To chase it anyway, open a courier conversation on a ticket for this order.
          </p>
        </Notice>
      )}

      <div className="os-fields" data-cols="2">
        <TextField
          id="admin-cons-name"
          label="Name"
          icon={<UserRound size={15} />}
          value={name ?? d.currentName}
          disabled={!d.editable || !canWrite}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          id="admin-cons-phone"
          label="Phone"
          value={phone ?? d.currentPhone}
          disabled={!d.editable || !canWrite}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>

      <TextField
        id="admin-cons-address"
        label="Address"
        hint="The street address only — see below for why the rest cannot move."
        value={address ?? d.currentAddressLine1}
        disabled={!d.editable || !canWrite}
        onChange={(e) => setAddress(e.target.value)}
      />

      <p className="oo-faint">
        {d.city} · {d.stateProvince} · <span className="sk-figure">{d.postalCode}</span> — fixed.
        The parcel is already sorted and routed on this pincode, so it cannot be sent somewhere
        else; only the street address can be corrected.
      </p>

      {d.editable && canWrite ? (
        <div className="oo-row oo-row--end">
          <AsyncButton
            variant="primary"
            size="sm"
            labels={{
              idle: 'Send to the courier',
              busy: 'Sending…',
              done: 'Sent',
              error: 'Not taken, try again',
            }}
            disabled={!dirty || change.isPending}
            onAction={submit}
          />
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="os-panel__block">
          <p className="oo-card__title">Changes made</p>
          <Timeline steps={steps} label="Changes made" />
        </div>
      ) : null}
    </OoSection>
  );
}
