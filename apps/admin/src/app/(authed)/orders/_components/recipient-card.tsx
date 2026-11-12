'use client';

import { Pencil, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, type ReactElement } from 'react';
import type { OrderView } from '@skydrop/api-client';
import {
  AddressCheckPanel,
  AddressParsedFields,
  addressParsedCount,
  type AddressCheckResult,
} from '@skydrop/ui/app/address-check';
import { Button } from '@skydrop/ui/app/button';
import { useT } from '@/i18n/client';
import type { ConsigneeEditability } from '@/lib/ops-hooks';
import { CustomerRiskStrip } from '../../call-center/_components/customer-risk-strip';
import { ConsigneeForm, ConsigneeHistory, ConsigneeLockedNotice } from './consignee-panel';
import { CopyButton } from './copy-button';
import { DetailCard, Disclosure } from './detail-card';

/**
 * Recipient & address — who the parcel is for and whether the address will
 * hold up, in ONE card. It replaces three: the recipient facts, the
 * customer-details form and the address check, each of which used to repeat
 * the others. Each piece of content now appears once.
 *
 *   read mode   left: the recipient and the customer's return history
 *               right: the address check (score, issues, what to ask)
 *   edit mode   left becomes the existing customer-details form, in place;
 *               the check stays visible beside it
 *
 * "Edit" exists only when the form does (`editAvailable` — the courier
 * allows the change AND the person holds `courier.ops.write`). It is the
 * caller's judgement, read from the same two sources the old form used.
 */
export function RecipientCard({
  order,
  check,
  consignee,
  editAvailable,
  editing,
  onEditingChange,
  open,
  onOpenChange,
  parsedOpen,
  onParsedOpenChange,
}: {
  readonly order: OrderView;
  readonly check: AddressCheckResult | null;
  readonly consignee: ConsigneeEditability | undefined;
  readonly editAvailable: boolean;
  readonly editing: boolean;
  readonly onEditingChange: (editing: boolean) => void;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly parsedOpen: boolean;
  readonly onParsedOpenChange: (open: boolean) => void;
}): ReactElement {
  const t = useT();
  const editBtn = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const attention = check !== null && check.issues.length > 0;
  const parsed = check === null ? 0 : addressParsedCount(check);
  const isEditing = editing && editAvailable && consignee !== undefined;

  // Leaving edit mode — cancel or a saved change — returns focus to Edit.
  useEffect(() => {
    if (wasEditing.current && !isEditing) editBtn.current?.focus();
    wasEditing.current = isEditing;
  }, [isEditing]);

  return (
    <DetailCard
      id="od-recipient"
      title={t('orderDetail.card.recipientAddress')}
      titleText={t('orderDetail.card.recipientAddress')}
      tone={attention ? 'warn' : undefined}
      badge={
        attention ? (
          <span className="od-attn">
            <TriangleAlert size={13} aria-hidden />
            {t('orderDetail.card.addressAttention')}
          </span>
        ) : undefined
      }
      actions={
        editAvailable && !isEditing ? (
          <Button
            ref={editBtn}
            variant="secondary"
            size="sm"
            icon={<Pencil size={13} />}
            onClick={() => onEditingChange(true)}
          >
            {t('common.edit')}
          </Button>
        ) : undefined
      }
      open={open}
      onOpenChange={onOpenChange}
    >
      <div className="od-recip" data-check={check !== null ? '1' : undefined}>
        <div className="od-recip__main">
          {isEditing && consignee !== undefined ? (
            <ConsigneeForm
              orderId={order.id}
              d={consignee}
              focusFirst
              onSaved={() => onEditingChange(false)}
              onCancel={() => onEditingChange(false)}
            />
          ) : (
            <RecipientRead order={order} />
          )}
        </div>
        {check !== null ? (
          <div className="od-recip__check">
            <AddressCheckPanel result={check} readOnly embedded />
          </div>
        ) : null}
      </div>

      {consignee !== undefined ? <ConsigneeLockedNotice d={consignee} /> : null}

      {check !== null && parsed > 0 ? (
        <Disclosure
          title={t('orderDetail.card.parsedFields', { count: parsed })}
          open={parsedOpen}
          onOpenChange={onParsedOpenChange}
        >
          <AddressParsedFields result={check} />
        </Disclosure>
      ) : null}

      <ConsigneeHistory orderId={order.id} />
    </DetailCard>
  );
}

/** The recipient as a person on the phone would want it: name, number, address. */
function RecipientRead({ order }: { readonly order: OrderView }): ReactElement {
  const t = useT();
  return (
    <div className="od-recipient">
      <p className="od-recipient__name">{order.recipientName}</p>
      <p className="od-recipient__phone sk-figure">
        <a href={`tel:${order.recipientPhoneE164}`} className="od-link">
          {order.recipientPhoneE164}
        </a>
        <CopyButton value={order.recipientPhoneE164} />
        {order.recipientAltPhoneE164 && (
          <span className="od-muted"> / {order.recipientAltPhoneE164}</span>
        )}
      </p>
      {order.recipientEmail ? <p className="od-muted">{order.recipientEmail}</p> : null}
      <address className="od-recipient__addr">
        <span>{order.recipientAddressLine1}</span>
        {order.recipientAddressLine2 ? <span>{order.recipientAddressLine2}</span> : null}
        {order.recipientLandmark ? (
          <span className="od-muted">
            {t('orderDetail.landmark')} {order.recipientLandmark}
          </span>
        ) : null}
        <span>
          {[order.recipientCity, order.recipientStateProvince].filter(Boolean).join(', ')}{' '}
          <span className="sk-figure">{order.recipientPostalCode}</span>{' '}
          <span className="od-muted">{order.recipientCountryCode}</span>
        </span>
      </address>
      {/* The same strip the call agent sees: the answer to "why did this
          one come back?" — a customer who returns a third of what they
          order was never a surprise. */}
      <CustomerRiskStrip orderId={order.id} />
    </div>
  );
}
