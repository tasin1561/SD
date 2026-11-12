'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { TriangleAlert, UserRound } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { TextField } from '@skydrop/ui/app/text-field';
import { Timeline, type TimelineStep } from '@skydrop/ui/app/timeline';
import { useToast } from '@skydrop/ui/app/toast';
import {
  useChangeConsignee,
  useConsignee,
  useConsigneeHistory,
  type ConsigneeEditability,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { Notice, OoSection } from './order-ops-parts';
import './order-shipping.css';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/client';

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
/**
 * The fields, the "fixed because routed" note and the send button — the
 * form itself, with the state it needs. Used in place by the legacy panel
 * below and inside the order page's Recipient & address card (edit mode).
 *
 * `onSaved` runs only after the courier accepted the change; `onCancel`
 * adds a Cancel button. `focusFirst` puts the cursor in the name field on
 * mount, so entering edit mode lands somewhere useful.
 */
export function ConsigneeForm({
  orderId,
  d,
  onSaved,
  onCancel,
  focusFirst = false,
}: {
  readonly orderId: string;
  readonly d: ConsigneeEditability;
  readonly onSaved?: (() => void) | undefined;
  readonly onCancel?: (() => void) | undefined;
  readonly focusFirst?: boolean;
}): ReactElement {
  const t = useT();
  const toast = useToast();
  const change = useChangeConsignee();
  // The order page is open to `orders.view`, which is a wider audience
  // than the courier surface. Not offering the control to someone who
  // may not use it, rather than letting them fill it in and collect a
  // 403 — the server still enforces it either way (FE-2).
  const canWrite = usePermission('courier.ops.write');

  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusFirst) first.current?.focus();
  }, [focusFirst]);

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
        toast.success(t('ordersConsigneePanel.sentToTheCourierWe'));
        onSaved?.();
      } else {
        toast.error(r.message ?? t('ordersConsigneePanel.theCourierWouldNotTake'));
        throw new Error('not accepted');
      }
    } catch (err) {
      if (!(err instanceof Error && err.message === 'not accepted')) {
        toast.error(serverVerdict(err));
      }
      throw err;
    }
  };

  return (
    <>
      <div className="os-fields" data-cols="2">
        <TextField
          ref={first}
          id="admin-cons-name"
          label={t('ordersConsigneePanel.name2')}
          icon={<UserRound size={15} />}
          value={name ?? d.currentName}
          disabled={!d.editable || !canWrite}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          id="admin-cons-phone"
          label={t('ordersConsigneePanel.phone2')}
          value={phone ?? d.currentPhone}
          disabled={!d.editable || !canWrite}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>

      <TextField
        id="admin-cons-address"
        label={t('ordersConsigneePanel.address2')}
        hint={t('ordersConsigneePanel.theStreetAddressOnlySee')}
        value={address ?? d.currentAddressLine1}
        disabled={!d.editable || !canWrite}
        onChange={(e) => setAddress(e.target.value)}
      />

      <p className="oo-faint">
        {richMessage(t('ordersConsigneePanel.fixedTheParcelIsAlready'), {
          city: d.city,
          stateProvince: d.stateProvince,
          span: <span className="sk-figure">{d.postalCode}</span>,
        })}
      </p>

      {d.editable && canWrite ? (
        <div className="oo-row oo-row--end">
          {onCancel !== undefined ? (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          ) : null}
          <AsyncButton
            variant="primary"
            size="sm"
            labels={{
              idle: t('ordersConsigneePanel.sendToTheCourier'),
              busy: t('ordersConsigneePanel.sending'),
              done: t('ordersConsigneePanel.sent'),
              error: t('ordersConsigneePanel.notTakenTryAgain'),
            }}
            disabled={!dirty || change.isPending}
            onAction={submit}
          />
        </div>
      ) : null}
    </>
  );
}

/** "Changes made": every consignee correction, with what the courier said. */
export function ConsigneeHistory({ orderId }: { readonly orderId: string }): ReactElement | null {
  const t = useT();
  const history = useConsigneeHistory(orderId);
  const rows = history.data ?? [];
  if (rows.length === 0) return null;

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
        r.nameBefore !== null
          ? t('ordersConsigneePanel.name', {
              nameBefore: r.nameBefore,
              nameAfter: String(r.nameAfter),
            })
          : null,
        r.phoneBefore !== null
          ? t('ordersConsigneePanel.phone', {
              phoneBefore: r.phoneBefore,
              phoneAfter: String(r.phoneAfter),
            })
          : null,
        r.addressBefore !== null
          ? t('ordersConsigneePanel.address', {
              addressBefore: r.addressBefore,
              addressAfter: String(r.addressAfter),
            })
          : null,
      ]
        .filter((x) => x !== null)
        .join(' · '),
      description:
        r.courierAcceptedAt === null ? (
          <span className="oo-bad">{t('ordersConsigneePanel.theCourierDidNotTake')}</span>
        ) : r.verifiedAt === null ? (
          <span className="oo-muted">{t('ordersConsigneePanel.sentConfirming')}</span>
        ) : r.verifiedMatch === true ? (
          <span className="oo-good">{t('ordersConsigneePanel.confirmedOnTheirSystem')}</span>
        ) : (
          <span className="oo-bad">{t('ordersConsigneePanel.theirSystemStillShowsThe')}</span>
        ),
    };
  });

  return (
    <div className="os-panel__block">
      <p className="oo-card__title">{t('ordersConsigneePanel.changesMade')}</p>
      <Timeline steps={steps} label={t('ordersConsigneePanel.changesMade')} />
    </div>
  );
}

/** The "these can no longer be changed" notice, for a parcel the courier has moved on. */
export function ConsigneeLockedNotice({
  d,
}: {
  readonly d: ConsigneeEditability;
}): ReactElement | null {
  const t = useT();
  if (d.editable) return null;
  return (
    <Notice
      tone="warn"
      icon={<TriangleAlert size={16} />}
      title={t('ordersConsigneePanel.theseCanNoLongerBe')}
    >
      <p>{d.reason}</p>
      <p className="oo-faint">{t('ordersConsigneePanel.toChaseItAnywayOpen')}</p>
    </Notice>
  );
}

export function ConsigneePanel({ orderId }: { readonly orderId: string }): ReactElement {
  const info = useConsignee(orderId);

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

  return <ConsigneePanelBody orderId={orderId} d={d} />;
}

function ConsigneePanelBody({
  orderId,
  d,
}: {
  readonly orderId: string;
  readonly d: ConsigneeEditability;
}): ReactElement {
  const t = useT();
  return (
    <OoSection
      title={t('ordersConsigneePanel.customerDetails')}
      note={d.editable ? d.reason : undefined}
    >
      {/*
        The same warning the seller gets, without their raise-an-issue
        button: an operator's route to the courier is the escalation
        on the ticket, which is somewhere else and already built.
      */}
      <ConsigneeLockedNotice d={d} />
      <ConsigneeForm orderId={orderId} d={d} />
      <ConsigneeHistory orderId={orderId} />
    </OoSection>
  );
}
