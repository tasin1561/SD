'use client';

import { useState, type ReactElement } from 'react';
import { AlertTriangle, OctagonX, PhoneCall, Truck } from 'lucide-react';
import { Dialog, DialogFooter, ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Select } from '@skydrop/ui/app/select';
import { TextArea } from '@skydrop/ui/app/text-field';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Notice, OrdSection } from '../../_components/orders-parts';
import {
  useCallHistory,
  useDeliveryActions,
  useRequestDeliveryAction,
  type DeliveryActionKind,
  type DeliveryActionStatus,
} from '@/lib/ops-hooks';
import { useSellerFees } from '@/lib/api-hooks';
import { feeOfKind, type FeeFigure } from '@/lib/fee-figure';
import { verdict } from '@/i18n/verdict';
import { useLocale, useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';
import { CATALOGS } from '@/i18n/catalog';
import type { Locale } from '@skydrop/ui/app/i18n';
import { CALL_OUTCOME_BN, DELIVERY_ACTION_STATUS_BN } from '@/i18n/enum-words';
import { dateTag } from '@/i18n/format';

/**
 * What happened to a parcel that could not be delivered, and what the
 * seller can do about it.
 *
 * Rendered while the parcel is actually in trouble, AND afterwards on an
 * order where something happened worth reading back. A panel about
 * failed deliveries on an order that arrived fine is noise, and noise on
 * every order is how people stop reading the one that matters.
 */

/**
 * What to call this panel, which is not always "the parcel is in
 * trouble".
 *
 * It was a two-branch ternary on the CURRENT order status —
 * DELIVERY_FAILED or, for everything else, "Out for delivery". That is
 * right for the two statuses the panel is rendered for while a parcel is
 * still moving, and wrong for every order it is rendered for AFTERWARDS,
 * which is most of them: the panel stays on any order with a call or a
 * delivery request against it, so a DELIVERED order carried a heading
 * saying "Out for delivery" two inches under a chip saying Delivered.
 *
 * Found by filming the order page (2026-09-30). Pure, and exported so it
 * can be pinned: the failure is a FALLBACK reappearing as the primary,
 * which a render test asserting "a heading is shown" passes either way.
 */
export function deliveryPanelTitleKey(orderStatus: string): MessageKey {
  if (orderStatus === 'DELIVERY_FAILED') return 'orderDelivery.deliveryDidNotSucceed';
  if (orderStatus === 'OUT_FOR_DELIVERY') return 'orderDelivery.outForDelivery';
  // Past it, one way or the other. The panel is then a RECORD — what was
  // said to the customer and what was asked for — so it is named for
  // that rather than for a state the order has left.
  return 'orderDelivery.whatHappenedWithThisDelivery';
}

/** The English heading — what the pinned spec asserts. The panel itself renders the key. */
export function deliveryPanelTitle(orderStatus: string): string {
  return CATALOGS.en[deliveryPanelTitleKey(orderStatus)];
}
function statusKind(s: DeliveryActionStatus): 'pending' | 'confirmed' | 'failed' | 'cancelled' {
  switch (s) {
    case 'PENDING':
    case 'APPROVED':
      return 'pending';
    case 'EXECUTED':
      return 'confirmed';
    case 'FAILED':
      return 'failed';
    case 'REJECTED':
    case 'EXPIRED':
      return 'cancelled';
  }
}

/** The ledger's own words, in the seller's. */
function humanOutcome(
  outcome: string,
  locale: Locale,
  bn?: Readonly<Record<string, string>>,
): string {
  if (locale === 'bn' && bn?.[outcome] !== undefined) return bn[outcome];
  return outcome
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

const ACTION_LABEL: Readonly<Record<DeliveryActionKind, MessageKey>> = {
  REATTEMPT: 'orderDelivery.tryDeliveringAgain',
  RECALL: 'orderDelivery.callTheCustomerForMe',
  RTO: 'orderDelivery.sendItBack',
};

/**
 * The three choices, and what each one actually does.
 *
 * A FUNCTION of the fee rather than a constant, because the send-back's
 * hint used to end "and a return fee applies" — naming no figure at all,
 * on the one choice that spends money the instant it is pressed. The fee
 * is `pricing.flat_rto_fee`, which is per seller and carries its own
 * currency (PRC-8), so it cannot be written into the sentence; and it is
 * a DIFFERENT fee from the one the delivered-order return dialog
 * charges, so a seller who read that dialog's figure and pressed this
 * button paid something else.
 *
 * With no figure available the old prose stands. Saying "a return fee
 * applies" is true; printing a dash or a zero is not.
 */
function actionsWith(
  t: Translate<MessageKey>,
  returnFee: FeeFigure | null,
): ReadonlyArray<{ value: DeliveryActionKind; label: string; hint: string }> {
  const cost =
    returnFee === null
      ? t('orderDelivery.aReturnFeeApplies')
      : returnFee.priced
        ? returnFee.agreed === null
          ? t('orderDelivery.costPriced', { primary: returnFee.primary })
          : t('orderDelivery.costPricedAgreed', {
              primary: returnFee.primary,
              agreed: returnFee.agreed,
            })
        : t('orderDelivery.theReturnFeeIs', { primary: returnFee.primary });
  return [
    {
      value: 'REATTEMPT',
      label: t(ACTION_LABEL.REATTEMPT),
      hint: t('orderDelivery.weAskTheCourier'),
    },
    {
      value: 'RECALL',
      label: t(ACTION_LABEL.RECALL),
      hint: t('orderDelivery.oneOfOurAgents'),
    },
    {
      value: 'RTO',
      label: t(ACTION_LABEL.RTO),
      hint: t('orderDelivery.rtoHint', { cost }),
    },
  ];
}

export function DeliveryTroublePanel({
  orderId,
  orderNumber,
  orderStatus,
  open,
  onOpenChange,
}: {
  readonly orderId: string;
  /** Restated when a send-back is confirmed. */
  readonly orderNumber?: string | undefined;
  readonly orderStatus: string;
  /**
   * The ask dialog, driven from the page header.
   *
   * The button that opens it now sits beside the order number, where a
   * seller looks for something to DO, rather than on this card — which
   * moved below the invoice and is read after the fact. Lifted rather
   * than duplicated: two buttons for one action is how the ticket page
   * came to have two message boxes.
   */
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}): ReactElement | null {
  const t = useT();
  const locale = useLocale();
  const inTrouble = orderStatus === 'DELIVERY_FAILED' || orderStatus === 'OUT_FOR_DELIVERY';
  const actions = useDeliveryActions(orderId);
  const calls = useCallHistory(orderId);
  const request = useRequestDeliveryAction();
  // Only while the ask dialog is up: a fee nobody is about to spend is
  // not worth a request on every order page.
  const fees = useSellerFees(open);
  const returnFee = feeOfKind(fees.data?.items, 'return');
  const ACTIONS = actionsWith(t, returnFee);

  const setOpen = onOpenChange;
  const [action, setAction] = useState<DeliveryActionKind>('REATTEMPT');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  // A send-back reaches the courier on the click and cannot be undone,
  // so it is confirmed once more, naming the order, before it is sent.
  const [confirmRto, setConfirmRto] = useState(false);

  const hasHistory = (actions.data?.items.length ?? 0) > 0 || (calls.data?.items.length ?? 0) > 0;
  // Shown while the parcel is in trouble, and afterwards only if
  // something actually happened worth reading back.
  if (!inTrouble && !hasHistory) return null;

  async function submit(): Promise<void> {
    setError(null);
    if (reason.trim().length < 10) {
      setError(t('orderDelivery.tellUsWhatYou'));
      return;
    }
    try {
      await request.mutateAsync({ orderId, action, reason: reason.trim() });
      setReason('');
      setOpen(false);
    } catch (err) {
      setError(verdict(err, t));
    }
  }

  return (
    <OrdSection title={t(deliveryPanelTitleKey(orderStatus))}>
      <div className="ord-stack">
        {orderStatus === 'DELIVERY_FAILED' && (
          <Notice tone="warn" icon={<AlertTriangle size={16} />}>
            <span>{t('orderDelivery.theCourierCouldNot')}</span>
          </Notice>
        )}

        {/* What we said to their customer. The reason this panel is
            worth reading: "no answer, twice" and "they moved house"
            lead to opposite decisions. */}
        {(calls.data?.items.length ?? 0) > 0 && (
          <div>
            <h3 className="ord-h3">{t('orderDelivery.whatWeDiscussedWith')}</h3>
            <ul className="ord-cards">
              {calls.data?.items.map((c) => (
                <li key={c.id} className="ord-callcard" data-tone="accent">
                  <div className="ord-callcard__head">
                    <PhoneCall size={14} aria-hidden />
                    <span className="ord-callcard__title">
                      {humanOutcome(c.outcome, locale, CALL_OUTCOME_BN)}
                    </span>
                    <span className="ord-callcard__time sk-figure">
                      {new Date(c.calledAt).toLocaleString(dateTag(locale))}
                    </span>
                  </div>
                  {/*
                    What the customer actually said. This is the answer
                    to whatever the seller asked for, so it is the
                    strongest line in the card.
                  */}
                  {c.notes !== null && c.notes !== '' && (
                    <p className="ord-callcard__said">{c.notes}</p>
                  )}
                  {c.customerSaidAddress !== null && (
                    <span className="ord-faint">
                      {richMessage(t('orderDelivery.customerGaveADifferent'), {
                        customerSaidAddress: c.customerSaidAddress,
                      })}
                    </span>
                  )}
                  {c.rescheduledFor !== null && (
                    <span className="ord-faint">
                      {richMessage(t('orderDelivery.askedUsToCall'), {
                        rescheduledFor: new Date(c.rescheduledFor).toLocaleString(dateTag(locale)),
                      })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(actions.data?.items.length ?? 0) > 0 && (
          <div>
            <h3 className="ord-h3">{t('orderDelivery.whatYouAskedFor')}</h3>
            <ul className="ord-cards">
              {actions.data?.items.map((a) => (
                <li key={a.id} className="ord-callcard">
                  <div className="ord-callcard__head">
                    <span className="ord-callcard__title">
                      {ACTION_LABEL[a.action] === undefined ? a.action : t(ACTION_LABEL[a.action])}
                    </span>
                    <span className="ord-callcard__time">
                      <StatusChip
                        kind={statusKind(a.status)}
                        label={humanOutcome(a.status, locale, DELIVERY_ACTION_STATUS_BN)}
                        size="sm"
                      />
                    </span>
                  </div>
                  <p className="ord-p">{a.reason}</p>
                  {a.decisionNote !== null && (
                    <span className="ord-faint">
                      {richMessage(t('orderDelivery.ourReply'), { decisionNote: a.decisionNote })}
                    </span>
                  )}
                  {a.executionError !== null && (
                    <span className="ord-error">
                      {richMessage(t('orderDelivery.couldNotBeCarried'), {
                        executionError: a.executionError,
                      })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title={t('orderDelivery.whatShouldWeDo')}
        icon={<Truck size={18} />}
        description={
          action === 'RTO'
            ? t('orderDelivery.returningYourOwnParcel')
            : t('orderDelivery.anOperatorReadsThis')
        }
        locked={request.isPending}
        footer={
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={request.isPending}>
              {t('orderDelivery.cancel')}
            </Button>
            <AsyncButton
              variant={action === 'RTO' ? 'destructive' : 'primary'}
              state={request.isPending ? 'busy' : undefined}
              labels={{
                idle:
                  action === 'RTO'
                    ? t('orderDelivery.sendItBackNow')
                    : t('orderDelivery.sendRequest'),
                busy: t('orderDelivery.sending'),
              }}
              disabled={request.isPending}
              onClick={() => {
                // A send-back is confirmed first; submit() still owns the
                // "tell us what you know" check, so a short reason is
                // refused by it exactly as before.
                if (action === 'RTO' && reason.trim().length >= 10) setConfirmRto(true);
                else void submit();
              }}
            />
          </DialogFooter>
        }
      >
        <div className="ord-stack ord-stack--tight">
          <Select
            label={t('orderDelivery.whatWouldYouLike')}
            required
            hint={ACTIONS.find((a) => a.value === action)?.hint}
            value={action}
            onChange={(e) => setAction(e.target.value as DeliveryActionKind)}
          >
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
          <TextArea
            label={t('orderDelivery.whatDoYouKnow')}
            required
            hint={t('orderDelivery.anythingThatHelpsThe')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={2000}
          />
          {error !== null && (
            <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
              <span>{error}</span>
            </Notice>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmRto}
        onOpenChange={setConfirmRto}
        title={t('orderDelivery.sendThisParcelBack')}
        entity={orderNumber ?? t('orderDelivery.thisOrder')}
        entityIsIdentifier={orderNumber !== undefined}
        consequence={
          returnFee === null
            ? t('orderDelivery.rtoConsequenceNone')
            : returnFee.priced
              ? t('orderDelivery.rtoConsequencePriced', { primary: returnFee.primary })
              : t('orderDelivery.rtoConsequenceUnpriced', { primary: returnFee.primary })
        }
        confirmLabel={t('orderDelivery.sendItBackNow')}
        destructive
        onConfirm={() => submit()}
      />
    </OrdSection>
  );
}
