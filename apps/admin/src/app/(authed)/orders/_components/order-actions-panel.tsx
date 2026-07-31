'use client';

import { useState, type ReactElement } from 'react';
import { ShieldAlert } from 'lucide-react';
import {
  ApiError,
  type ForceMutationResult,
  type OrderView,
  type ReleaseReservationsResult,
} from '@skydrop/api-client';
import { OrderCancellationReason, OrderStatus, type StaffRole } from '@skydrop/db';
import { hasStaffRole, useStaffIdentity } from '@skydrop/auth/client';
import { useCancelOrder } from '@/lib/api-hooks';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  FormField,
  Select,
  Textarea,
  Modal,
  ModalFooter,
} from '@skydrop/ui/components';
import { ForceMutationDialog } from './force-mutation-dialog';
import { ReleaseReservationsDialog } from './release-reservations-dialog';

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
const OVERRIDE_ROLES: readonly StaffRole[] = ['SUPER_ADMIN' as StaffRole];

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
  const staff = useStaffIdentity();
  const canOverride = hasStaffRole(staff, OVERRIDE_ROLES);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState<OrderCancellationReason>(OrderCancellationReason.OTHER);
  const [note, setNote] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const cancel = useCancelOrder(order.id);

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);

  const [lastOverride, setLastOverride] = useState<ForceMutationResult | null>(null);
  const [lastRelease, setLastRelease] = useState<ReleaseReservationsResult | null>(null);

  const inTerminalState = TERMINAL_STATUSES.includes(order.status);

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
      if (err instanceof ApiError && typeof err.body === 'object' && err.body !== null) {
        const body = err.body as { message?: unknown; code?: unknown };
        const msg = typeof body.message === 'string' ? body.message : err.message;
        const code = typeof body.code === 'string' ? body.code : null;
        setServerError(code ? `[${code}] ${msg}` : msg);
      } else if (err instanceof Error) {
        setServerError(err.message);
      } else {
        setServerError('Failed to cancel order.');
      }
    }
  }

  return (
    <Card>
      <CardHeader
        title="Lifecycle actions"
        subtitle="State-machine-guarded transitions. The server enforces legal moves; the UI shows the action and surfaces the server's verdict."
      />
      <CardBody className="space-y-4">
        <div>
          <div className="text-text-faint text-[11px] uppercase tracking-wide mb-2">
            Sane actions
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="destructive"
              size="md"
              disabled={inTerminalState || cancel.isPending}
              onClick={() => setCancelOpen(true)}
              title={
                inTerminalState
                  ? `Already in a terminal state (${order.status.toLowerCase()})`
                  : 'Cancel via the matrix (releases stock if reserved)'
              }
            >
              Cancel order
            </Button>
          </div>
          {inTerminalState && (
            <div className="text-text-faint text-xs mt-2">
              This order is in a terminal state; further sane lifecycle actions aren&apos;t
              available. God-mode override below is the extraordinary-correction path.
            </div>
          )}
        </div>

        <div
          className="rounded-[5px] px-3 py-3 space-y-2"
          style={{
            background: 'var(--color-critical-tint)',
            border: '1px solid var(--color-critical-ring)',
          }}
        >
          <div className="flex items-center gap-1.5 text-critical text-[11px] uppercase tracking-wide font-medium">
            <ShieldAlert size={12} />
            God-mode (ORD-2)
          </div>
          <p className="text-text-body text-xs leading-snug">
            Bypass the state machine and edit rules. Audited{' '}
            <span className="font-mono uppercase">CRITICAL</span>. The order will be marked with{' '}
            <span className="font-mono">hasAdminOverride</span> permanently — a flag that is set
            once and never cleared.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              variant="override"
              size="md"
              onClick={() => setOverrideOpen(true)}
              disabled={!canOverride}
              title={canOverride ? undefined : 'Requires SUPER_ADMIN role'}
            >
              <ShieldAlert size={14} /> Force-mutate…
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
          </div>
          {!canOverride && (
            <div className="text-text-faint text-xs">
              Your role can&apos;t use god-mode. Contact a super-admin if an extraordinary
              correction is required.
            </div>
          )}
        </div>

        {lastOverride && (
          <OverrideResultPanel result={lastOverride} onDismiss={() => setLastOverride(null)} />
        )}
        {lastRelease && (
          <ReleaseResultPanel result={lastRelease} onDismiss={() => setLastRelease(null)} />
        )}
      </CardBody>

      {/* Sane cancel modal */}
      <Modal
        open={cancelOpen}
        onOpenChange={(o) => !o && closeCancel()}
        title={
          <>
            Cancel order <span className="font-mono">{order.orderNumber}</span>?
          </>
        }
        description="Sane admin cancel — drives the order through the state machine to CANCELLED_BY_ADMIN. Any active stock reservation will be released by the saga."
      >
        <div className="space-y-3">
          <FormField label="Cancellation reason" htmlFor="cancel-reason" required>
            <Select
              id="cancel-reason"
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
          </FormField>
          <FormField
            label="Internal note (optional)"
            htmlFor="cancel-note"
            hint="Recorded in the order event + audit log; not visible to the seller."
          >
            <Textarea
              id="cancel-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              disabled={cancel.isPending}
            />
          </FormField>
          {serverError && (
            <div
              className="px-2.5 py-1.5 rounded-[5px] text-critical text-xs"
              style={{
                background: 'var(--color-critical-tint)',
                border: '1px solid var(--color-critical-ring)',
              }}
            >
              {serverError}
            </div>
          )}
        </div>
        <ModalFooter>
          <Button variant="ghost" size="md" onClick={closeCancel} disabled={cancel.isPending}>
            Keep order
          </Button>
          <Button
            variant="destructive"
            size="md"
            onClick={() => {
              void confirmCancel();
            }}
            disabled={cancel.isPending}
          >
            {cancel.isPending ? 'Cancelling…' : 'Confirm cancel'}
          </Button>
        </ModalFooter>
      </Modal>

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
        onSuccess={(result) => setLastRelease(result)}
      />
    </Card>
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
    <div
      className="rounded-[5px] px-3 py-3"
      style={{
        background: 'var(--color-critical-tint)',
        border: '1px solid var(--color-critical-ring)',
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-critical text-[11px] uppercase tracking-wide font-medium">
          Force-mutation applied
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-text-faint hover:text-text-body text-xs"
        >
          Dismiss
        </button>
      </div>
      <dl className="grid grid-cols-[minmax(84px,36%)_1fr] sm:grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-text-muted">Status</dt>
        <dd className="text-text-body font-mono">
          {result.fromStatus !== result.status
            ? `${result.fromStatus} → ${result.status}`
            : `unchanged (${result.status})`}
        </dd>
        <dt className="text-text-muted">Fields applied</dt>
        <dd className="text-text-body font-mono">
          {result.fieldChangesApplied.length === 0 ? '—' : result.fieldChangesApplied.join(', ')}
        </dd>
        <dt className="text-text-muted">hasAdminOverride</dt>
        <dd className="text-critical font-mono">true (permanent)</dd>
      </dl>

      {result.reserveOutcomes && result.reserveOutcomes.length > 0 && (
        <div className="mt-2 pt-2 border-t border-[var(--color-critical-ring)]">
          <div className="text-text-muted text-[11px] uppercase tracking-wide mb-1">
            Reserve attempts (attempted, NOT blocking)
          </div>
          <ul className="space-y-0.5">
            {result.reserveOutcomes.map((o) => (
              <li key={o.orderItemId} className="text-xs font-mono flex items-start gap-2">
                <span className={o.ok ? 'text-delivered' : 'text-critical'}>
                  {o.ok ? '✓' : '✗'}
                </span>
                <span className="text-text-body truncate flex-1">
                  {o.orderItemId.slice(0, 8)}…{' '}
                  {o.ok
                    ? `reserved (${o.reservationId?.slice(0, 8)}…)`
                    : `failed: ${o.error ?? 'unknown'}`}
                </span>
              </li>
            ))}
          </ul>
          <div className="text-text-faint text-[11px] mt-1.5 leading-snug">
            Some attempts may have failed (e.g., insufficient stock); the saga did NOT block or
            compensate. Use the release-reservations action above if cleanup is needed.
          </div>
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
    <div className="rounded-[5px] px-3 py-3 border border-border bg-bg">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="text-text-bright text-[11px] uppercase tracking-wide font-medium">
          Reservations released
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-text-faint hover:text-text-body text-xs"
        >
          Dismiss
        </button>
      </div>
      <div className="text-text-body text-sm">
        Released <span className="font-mono">{result.releasedCount}</span> reservation(s).
      </div>
      {result.released.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {result.released.map((r) => (
            <li key={r.reservationId} className="text-xs font-mono text-text-muted">
              {r.reservationId.slice(0, 8)}… · qty {r.qtyReleased}
              {r.alreadyInactive && (
                <span className="text-text-faint ml-1">(already inactive)</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
