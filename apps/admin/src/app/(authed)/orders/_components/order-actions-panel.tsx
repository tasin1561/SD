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

const CANCELLATION_REASONS: ReadonlyArray<{
  value: OrderCancellationReason;
  label: string;
}> = [
  { value: OrderCancellationReason.CUSTOMER_REQUESTED, label: 'Customer requested' },
  { value: OrderCancellationReason.CUSTOMER_UNREACHABLE, label: 'Customer unreachable' },
  { value: OrderCancellationReason.WRONG_ADDRESS, label: 'Wrong address' },
  { value: OrderCancellationReason.OUT_OF_STOCK, label: 'Out of stock' },
  { value: OrderCancellationReason.FAKE_ORDER, label: 'Fake order' },
  { value: OrderCancellationReason.HIGH_RISK_CUSTOMER, label: 'High-risk customer' },
  { value: OrderCancellationReason.DUPLICATE_ORDER, label: 'Duplicate order' },
  { value: OrderCancellationReason.NO_COURIER_AVAILABLE, label: 'No courier available' },
  { value: OrderCancellationReason.SELLER_REQUESTED, label: 'Seller requested' },
  { value: OrderCancellationReason.OTHER, label: 'Other' },
];

export function OrderActionsPanel({ order }: { readonly order: OrderView }): ReactElement {
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
      setServerError(serverVerdict(err, 'Failed to cancel order.'));
      throw err;
    }
  }

  return (
    <OoCard>
      <div className="oo-card__head">
        <div className="oo-stack oo-stack--tight">
          <p className="oo-card__title">Lifecycle actions</p>
          <p className="oo-p">
            State-machine-guarded transitions. The server enforces legal moves; the UI shows the
            action and surfaces the server&apos;s verdict.
          </p>
        </div>
      </div>

      <div className="oc-group">
        <p className="oc-group__label">Sane actions</p>
        <div className="oo-row">
          <Button
            variant="destructive"
            size="md"
            disabled={inTerminalState || cancel.isPending || !canCancel}
            onClick={() => setCancelOpen(true)}
            title={
              inTerminalState
                ? `Already in a terminal state (${order.status.toLowerCase()})`
                : 'Cancel via the matrix (releases stock if reserved)'
            }
          >
            Cancel order
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
              title="The customer wants to send it back — charged to the seller as a second delivery"
            >
              Request return
            </Button>
          )}
        </div>
        {inTerminalState && (
          <p className="oo-faint">
            This order is in a terminal state; further sane lifecycle actions aren&apos;t available.
            God-mode override below is the extraordinary-correction path.
          </p>
        )}
      </div>

      <div className="oc-god-panel">
        <p className="oc-god-panel__title">
          <ShieldAlert size={14} aria-hidden />
          God-mode (ORD-2)
        </p>
        <p className="oc-god-panel__body">
          Bypass the state machine and edit rules. Audited{' '}
          <span className="sk-ident">CRITICAL</span>. The order will be marked with{' '}
          <span className="sk-ident">hasAdminOverride</span> permanently — a flag that is set once
          and never cleared.
        </p>
        <div className="oo-row">
          <Button
            variant="destructive"
            size="md"
            icon={<ShieldAlert size={14} />}
            onClick={() => setOverrideOpen(true)}
            disabled={!canOverride}
            title={canOverride ? undefined : 'Requires the god-mode override permission'}
          >
            Force-mutate…
          </Button>
          <Button
            variant="destructive"
            size="md"
            onClick={() => setReleaseOpen(true)}
            disabled={!canOverride}
            title={
              canOverride
                ? 'Release every ACTIVE reservation (cleanup after a god-mode move). Idempotent.'
                : 'Requires SUPER_ADMIN role'
            }
          >
            Release reservations…
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
                ? 'Re-reserve stock for an order that lost its claim to an expired reservation. Refused if it already holds one.'
                : 'Requires SUPER_ADMIN role'
            }
          >
            Restore stock claim…
          </Button>
        </div>
        {!canOverride && (
          <p className="oo-faint">
            Your role does not include the god-mode override permission. Ask a super admin if an
            extraordinary correction is required.
          </p>
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
        title="Cancel this order?"
        entity={order.orderNumber}
        entityIsIdentifier
        consequence="Sane admin cancel — drives the order through the state machine to CANCELLED_BY_ADMIN. Any active stock reservation will be released by the saga."
        confirmLabel="Confirm cancel"
        cancelLabel="Keep order"
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
          <p className="oo-faint">
            If a delivery fee has already been charged for this order and the parcel has not been
            dispatched, it is credited back to the seller&apos;s wallet automatically. Once
            dispatched, the fee stands — the courier already has the parcel.
          </p>
          <Select
            id="cancel-reason"
            label="Cancellation reason"
            requiredMark
            value={reason}
            onChange={(e) => setReason(e.target.value as OrderCancellationReason)}
            disabled={cancel.isPending}
          >
            {CANCELLATION_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
          <TextArea
            id="cancel-note"
            label="Internal note (optional)"
            hint="Recorded in the order event + audit log; not visible to the seller."
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
              ? `Reserved ${result.reservedCount} line(s) again — ${result.orderNumber} can be picked.`
              : `Nothing reserved: ${result.shortfall}`,
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
  return (
    <div className="oc-result" data-tone="critical" role="status">
      <div className="oc-result__head">
        <p className="oc-result__title">Force-mutation applied</p>
        <button type="button" onClick={onDismiss} className="oo-link">
          Dismiss
        </button>
      </div>
      <Facts
        items={[
          {
            label: 'Status',
            value: (
              <span className="sk-ident">
                {result.fromStatus !== result.status
                  ? `${result.fromStatus} → ${result.status}`
                  : `unchanged (${result.status})`}
              </span>
            ),
          },
          {
            label: 'Fields applied',
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
            value: <span className="oo-bad">true (permanent)</span>,
          },
        ]}
      />

      {result.resellerMoney?.refusal != null && (
        <div className="oc-result__rule">
          <p className="oo-strong">The money on this reseller order did NOT follow the change</p>
          <p className="oo-bad oo-p">
            {result.resellerMoney.refusal === 'ALREADY_PAID'
              ? 'A credit on this order had already been paid, so it could not be worked out again. The order now says one figure and the wallets say another.'
              : 'Re-pricing this order failed. The stale figures are what would be paid until it succeeds.'}
          </p>
          <p className="oo-faint">
            This is open on /system-issues (MONEY, HIGH) and the store and seller staff have been
            told. Settle the difference on the order’s ticket, or call the order off and place it
            again.
          </p>
        </div>
      )}

      {result.reserveOutcomes && result.reserveOutcomes.length > 0 && (
        <div className="oc-result__rule">
          <p className="oo-strong">Reserve attempts (attempted, NOT blocking)</p>
          <ul className="oc-outcomes">
            {result.reserveOutcomes.map((o) => (
              <li key={o.orderItemId}>
                {o.ok ? (
                  <Check size={14} className="oo-good" aria-label="Reserved" />
                ) : (
                  <X size={14} className="oo-bad" aria-label="Failed" />
                )}
                <span className="oc-outcomes__text sk-ident">
                  {o.orderItemId.slice(0, 8)}…{' '}
                  {o.ok
                    ? `reserved (${o.reservationId?.slice(0, 8)}…)`
                    : `failed: ${o.error ?? 'unknown'}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="oo-faint">
            Some attempts may have failed (e.g., insufficient stock); the saga did NOT block or
            compensate. Use the release-reservations action above if cleanup is needed.
          </p>
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
  return (
    <div className="oc-result" role="status">
      <div className="oc-result__head">
        <p className="oc-result__title">Reservations released</p>
        <button type="button" onClick={onDismiss} className="oo-link">
          Dismiss
        </button>
      </div>
      <p className="oo-p">
        Released <span className="sk-figure oo-strong">{result.releasedCount}</span> reservation(s).
      </p>
      {result.released.length > 0 && (
        <ul className="oc-outcomes">
          {result.released.map((r) => (
            <li key={r.reservationId} className="oo-muted">
              <span className="oc-outcomes__text">
                <span className="sk-ident">{r.reservationId.slice(0, 8)}…</span> · qty{' '}
                <span className="sk-figure">{r.qtyReleased}</span>
                {r.alreadyInactive && <span className="oo-faint"> (already inactive)</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
