'use client';

import { useState, type ReactElement } from 'react';
import { AdminRequestReturnDialog } from './admin-request-return-dialog';
import { Check, ShieldAlert, X } from 'lucide-react';
import {
  type ForceMutationResult,
  type OrderView,
  type ReleaseReservationsResult,
} from '@skydrop/api-client';
import { OrderCancellationReason, OrderStatus } from '@skydrop/db';
import { usePermission } from '@/lib/use-permission';
import { useCancelOrder } from '@/lib/api-hooks';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { TextArea } from '@skydrop/ui/app/text-field';
import { Facts, Notice, OoCard } from './order-ops-parts';
import './order-core.css';
import { ForceMutationDialog } from './force-mutation-dialog';
import { ReleaseReservationsDialog } from './release-reservations-dialog';
import { RestoreReservationsDialog } from './restore-reservations-dialog';
import { serverVerdict } from '@/lib/server-verdict';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

const TERMINAL_STATUSES: readonly OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.CANCELLED_BY_ADMIN,
  OrderStatus.REJECTED,
  OrderStatus.REJECTED_BY_CUSTOMER,
  OrderStatus.REJECTED_NDR,
  OrderStatus.RTO_RESTOCKED,
  OrderStatus.RTO_DAMAGED,
  OrderStatus.LOST_IN_TRANSIT,
];

// Cosmetic RBAC (FE-2) — SUPER_ADMIN only for the destructive god-
// mode surfaces. The server has no requireStaffRoles on these
// endpoints today (every admin endpoint is StaffJwtGuard-only in
// Phase 1A — phase-1a-debt). We gate the UI as if the RBAC will land;
// the server will reject regardless once it does.
// Was `['SUPER_ADMIN']` checked against the role NAME, which stopped
// being true the moment roles became data: a "Warehouse manager"
// somebody creates and gives `orders.override` to would have been shown
// a disabled button and told to contact a super admin. The permission is
// the thing the server actually checks, so it is the thing to ask about.

const CANCELLATION_REASONS = (
  t: Translate<MessageKey>,
): ReadonlyArray<{
  value: OrderCancellationReason;
  label: string;
}> => [
  {
    value: OrderCancellationReason.CUSTOMER_REQUESTED,
    label: t('ordersOrderActionsPanel.customerRequested'),
  },
  {
    value: OrderCancellationReason.CUSTOMER_UNREACHABLE,
    label: t('ordersOrderActionsPanel.customerUnreachable'),
  },
  {
    value: OrderCancellationReason.WRONG_ADDRESS,
    label: t('ordersOrderActionsPanel.wrongAddress'),
  },
  { value: OrderCancellationReason.OUT_OF_STOCK, label: t('ordersOrderActionsPanel.outOfStock') },
  { value: OrderCancellationReason.FAKE_ORDER, label: t('ordersOrderActionsPanel.fakeOrder') },
  {
    value: OrderCancellationReason.HIGH_RISK_CUSTOMER,
    label: t('ordersOrderActionsPanel.highRiskCustomer'),
  },
  {
    value: OrderCancellationReason.DUPLICATE_ORDER,
    label: t('ordersOrderActionsPanel.duplicateOrder'),
  },
  {
    value: OrderCancellationReason.NO_COURIER_AVAILABLE,
    label: t('ordersOrderActionsPanel.noCourierAvailable'),
  },
  {
    value: OrderCancellationReason.SELLER_REQUESTED,
    label: t('ordersOrderActionsPanel.clientRequested'),
  },
  { value: OrderCancellationReason.OTHER, label: t('ordersOrderActionsPanel.other') },
];

export function OrderActionsPanel({ order }: { readonly order: OrderView }): ReactElement {
  const t = useT();

  const canOverride = usePermission('orders.override');
  const canCancel = usePermission('orders.cancel');

  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState<OrderCancellationReason>(OrderCancellationReason.OTHER);
  const [note, setNote] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const cancel = useCancelOrder(order.id);

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreNote, setRestoreNote] = useState<string | null>(null);

  const [lastOverride, setLastOverride] = useState<ForceMutationResult | null>(null);
  const [lastRelease, setLastRelease] = useState<ReleaseReservationsResult | null>(null);

  const inTerminalState = TERMINAL_STATUSES.includes(order.status);
  const [returnOpen, setReturnOpen] = useState(false);

  function closeCancel(): void {
    setCancelOpen(false);
    setReason(OrderCancellationReason.OTHER);
    setNote('');
    setServerError(null);
  }

  async function confirmCancel(): Promise<void> {
    setServerError(null);
    try {
      await cancel.mutateAsync({
        cancellationReason: reason,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      closeCancel();
    } catch (err) {
      setServerError(serverVerdict(err, t('ordersOrderActionsPanel.failedToCancelOrder')));
      throw err;
    }
  }

  return (
    <OoCard>
      <div className="oo-card__head">
        <div className="oo-stack oo-stack--tight">
          <p className="oo-card__title">{t('ordersOrderActionsPanel.lifecycleActions')}</p>
          <p className="oo-p">{t('ordersOrderActionsPanel.stateMachineGuardedTransitionsThe')}</p>
        </div>
      </div>

      <div className="oc-group">
        <p className="oc-group__label">{t('ordersOrderActionsPanel.saneActions')}</p>
        <div className="oo-row">
          <Button
            variant="destructive"
            size="md"
            disabled={inTerminalState || cancel.isPending || !canCancel}
            onClick={() => setCancelOpen(true)}
            title={
              inTerminalState
                ? t('ordersOrderActionsPanel.alreadyInATerminalState', {
                    value: order.status.toLowerCase(),
                  })
                : t('ordersOrderActionsPanel.cancelViaTheMatrixReleases')
            }
          >
            {t('ordersOrderActionsPanel.cancelOrder')}
          </Button>

          {/* DELIVERED is terminal for everything else, which is why
              this sits outside the terminal-state guard above: a
              customer return is the one lifecycle move a finished
              order still has. The call-centre case — the customer
              rings us rather than the seller. */}
          {order.status === 'DELIVERED' && canCancel && (
            <Button
              variant="secondary"
              size="md"
              onClick={() => setReturnOpen(true)}
              title={t('ordersOrderActionsPanel.theCustomerWantsToSend')}
            >
              {t('ordersOrderActionsPanel.requestReturn')}
            </Button>
          )}
        </div>
        {inTerminalState && (
          <p className="oo-faint">{t('ordersOrderActionsPanel.thisOrderIsInA')}</p>
        )}
      </div>

      <div className="oc-god-panel">
        <p className="oc-god-panel__title">
          <ShieldAlert size={14} aria-hidden />
          {t('ordersOrderActionsPanel.godModeOrd2')}
        </p>
        <p className="oc-god-panel__body">
          {richMessage(t('ordersOrderActionsPanel.bypassTheStateMachineAnd'), {
            span: <span className="sk-ident">CRITICAL</span>,
            span2: <span className="sk-ident">hasAdminOverride</span>,
          })}
        </p>
        <div className="oo-row">
          <Button
            variant="destructive"
            size="md"
            icon={<ShieldAlert size={14} />}
            onClick={() => setOverrideOpen(true)}
            disabled={!canOverride}
            title={
              canOverride ? undefined : t('ordersOrderActionsPanel.requiresTheGodModeOverride')
            }
          >
            {t('ordersOrderActionsPanel.forceMutate')}
          </Button>
          <Button
            variant="destructive"
            size="md"
            onClick={() => setReleaseOpen(true)}
            disabled={!canOverride}
            title={
              canOverride
                ? t('ordersOrderActionsPanel.releaseEveryActiveReservationCleanup')
                : t('ordersOrderActionsPanel.requiresSuperAdminRole')
            }
          >
            {t('ordersOrderActionsPanel.releaseReservations')}
          </Button>
          {/* The mirror. Sits beside the release because they are the
              two halves of one question — this order's stock claim —
              and looking for one while only the other exists is how a
              stuck order stays stuck. */}
          <Button
            variant="secondary"
            size="md"
            onClick={() => setRestoreOpen(true)}
            disabled={!canOverride}
            title={
              canOverride
                ? t('ordersOrderActionsPanel.reReserveStockForAn')
                : t('ordersOrderActionsPanel.requiresSuperAdminRole')
            }
          >
            {t('ordersOrderActionsPanel.restoreStockClaim')}
          </Button>
        </div>
        {!canOverride && (
          <p className="oo-faint">{t('ordersOrderActionsPanel.yourRoleDoesNotInclude')}</p>
        )}
      </div>

      {restoreNote !== null && (
        <Notice tone="info" role="status">
          <p>
            {restoreNote}{' '}
            <button type="button" className="oo-link" onClick={() => setRestoreNote(null)}>
              dismiss
            </button>
          </p>
        </Notice>
      )}

      {lastOverride && (
        <OverrideResultPanel result={lastOverride} onDismiss={() => setLastOverride(null)} />
      )}
      {lastRelease && (
        <ReleaseResultPanel result={lastRelease} onDismiss={() => setLastRelease(null)} />
      )}

      <AdminRequestReturnDialog
        orderId={order.id}
        orderNumber={order.orderNumber}
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
      />

      {/* Sane cancel — the reason and note travel with the confirm. */}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={(o) => {
          if (!o) closeCancel();
        }}
        title={t('ordersOrderActionsPanel.cancelThisOrder')}
        entity={order.orderNumber}
        entityIsIdentifier
        consequence={t('ordersOrderActionsPanel.saneAdminCancelDrivesThe')}
        confirmLabel={t('ordersOrderActionsPanel.confirmCancel')}
        cancelLabel={t('ordersOrderActionsPanel.keepOrder')}
        destructive
        onConfirm={confirmCancel}
        error={serverError}
      >
        <div className="oo-stack oo-stack--tight">
          {/* Money moves here, and the operator should know before they
              press it rather than field the seller's question later.
              Stated as a rule, not a figure: the panel does not know
              whether this particular order was charged, and inventing a
              number would be worse than naming the condition. */}
          <p className="oo-faint">{t('ordersOrderActionsPanel.ifADeliveryFeeHas')}</p>
          <Select
            id="cancel-reason"
            label={t('ordersOrderActionsPanel.cancellationReason')}
            requiredMark
            value={reason}
            onChange={(e) => setReason(e.target.value as OrderCancellationReason)}
            disabled={cancel.isPending}
          >
            {CANCELLATION_REASONS(t).map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
          <TextArea
            id="cancel-note"
            label={t('ordersOrderActionsPanel.internalNoteOptional')}
            hint={t('ordersOrderActionsPanel.recordedInTheOrderEvent')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            disabled={cancel.isPending}
          />
        </div>
      </ConfirmDialog>

      <ForceMutationDialog
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
        order={order}
        onSuccess={(result) => setLastOverride(result)}
      />

      <ReleaseReservationsDialog
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
        orderId={order.id}
        orderNumber={order.orderNumber}
        onSuccess={(result) => setLastRelease(result)}
      />

      <RestoreReservationsDialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        orderId={order.id}
        orderNumber={order.orderNumber}
        onSuccess={(result) => {
          setRestoreNote(
            result.shortfall === null
              ? t('ordersOrderActionsPanel.reservedLineSAgainCan', {
                  reservedCount: result.reservedCount,
                  orderNumber: result.orderNumber,
                })
              : t('ordersOrderActionsPanel.nothingReserved', { shortfall: result.shortfall }),
          );
        }}
      />
    </OoCard>
  );
}

/**
 * Post-force-mutate notification. Surfaces:
 *   - The new (or same) status.
 *   - Field changes applied (count + list).
 *   - The reserve outcomes (one row per attempted reservation) — this
 *     is where the FE-2 trust-the-server discipline becomes visible:
 *     we render what the SERVER reports happened on the inventory side,
 *     we don't infer it.
 *   - A reminder that `hasAdminOverride` is now true forever.
 */
function OverrideResultPanel({
  result,
  onDismiss,
}: {
  readonly result: ForceMutationResult;
  readonly onDismiss: () => void;
}): ReactElement {
  const t = useT();
  return (
    <div className="oc-result" data-tone="critical" role="status">
      <div className="oc-result__head">
        <p className="oc-result__title">{t('ordersOrderActionsPanel.forceMutationApplied')}</p>
        <button type="button" onClick={onDismiss} className="oo-link">
          {t('ordersOrderActionsPanel.dismiss')}
        </button>
      </div>
      <Facts
        items={[
          {
            label: t('ordersOrderActionsPanel.status'),
            value: (
              <span className="sk-ident">
                {result.fromStatus !== result.status
                  ? `${result.fromStatus} → ${result.status}`
                  : t('ordersOrderActionsPanel.unchanged', { status: result.status })}
              </span>
            ),
          },
          {
            label: t('ordersOrderActionsPanel.fieldsApplied'),
            value: (
              <span className="sk-ident">
                {result.fieldChangesApplied.length === 0
                  ? '—'
                  : result.fieldChangesApplied.join(', ')}
              </span>
            ),
          },
          {
            label: 'hasAdminOverride',
            value: <span className="oo-bad">{t('ordersOrderActionsPanel.truePermanent')}</span>,
          },
        ]}
      />

      {result.resellerMoney?.refusal != null && (
        <div className="oc-result__rule">
          <p className="oo-strong">{t('ordersOrderActionsPanel.theMoneyOnThisMember')}</p>
          <p className="oo-bad oo-p">
            {result.resellerMoney.refusal === 'ALREADY_PAID'
              ? t('ordersOrderActionsPanel.aCreditOnThisOrder')
              : t('ordersOrderActionsPanel.rePricingThisOrderFailed')}
          </p>
          <p className="oo-faint">{t('ordersOrderActionsPanel.thisIsOpenOnSystem')}</p>
        </div>
      )}

      {result.reserveOutcomes && result.reserveOutcomes.length > 0 && (
        <div className="oc-result__rule">
          <p className="oo-strong">
            {t('ordersOrderActionsPanel.reserveAttemptsAttemptedNotBlocking')}
          </p>
          <ul className="oc-outcomes">
            {result.reserveOutcomes.map((o) => (
              <li key={o.orderItemId}>
                {o.ok ? (
                  <Check
                    size={14}
                    className="oo-good"
                    aria-label={t('ordersOrderActionsPanel.reserved')}
                  />
                ) : (
                  <X
                    size={14}
                    className="oo-bad"
                    aria-label={t('ordersOrderActionsPanel.failed')}
                  />
                )}
                <span className="oc-outcomes__text sk-ident">
                  {o.orderItemId.slice(0, 8)}…{' '}
                  {o.ok
                    ? t('ordersOrderActionsPanel.reserved2', {
                        value: String(o.reservationId?.slice(0, 8)),
                      })
                    : t('ordersOrderActionsPanel.failedError', {
                        error: o.error ?? t('ordersOrderActionsPanel.unknown'),
                      })}
                </span>
              </li>
            ))}
          </ul>
          <p className="oo-faint">{t('ordersOrderActionsPanel.someAttemptsMayHaveFailed')}</p>
        </div>
      )}
    </div>
  );
}

function ReleaseResultPanel({
  result,
  onDismiss,
}: {
  readonly result: ReleaseReservationsResult;
  readonly onDismiss: () => void;
}): ReactElement {
  const t = useT();

  return (
    <div className="oc-result" role="status">
      <div className="oc-result__head">
        <p className="oc-result__title">{t('ordersOrderActionsPanel.reservationsReleased')}</p>
        <button type="button" onClick={onDismiss} className="oo-link">
          {t('ordersOrderActionsPanel.dismiss')}
        </button>
      </div>
      <p className="oo-p">
        {richMessage(t('ordersOrderActionsPanel.releasedReservationS'), {
          span: <span className="sk-figure oo-strong">{result.releasedCount}</span>,
        })}
      </p>
      {result.released.length > 0 && (
        <ul className="oc-outcomes">
          {result.released.map((r) => (
            <li key={r.reservationId} className="oo-muted">
              <span className="oc-outcomes__text">
                {richMessage(t('ordersOrderActionsPanel.qty'), {
                  span: <span className="sk-ident">{r.reservationId.slice(0, 8)}…</span>,
                  span2: <span className="sk-figure">{r.qtyReleased}</span>,
                })}
                {r.alreadyInactive && (
                  <span className="oo-faint"> {t('ordersOrderActionsPanel.alreadyInactive')}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
