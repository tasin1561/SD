'use client';

import { useState, type ReactElement } from 'react';
import { ApiError } from '@skydrop/api-client';
import { OrderCancellationReason, OrderStatus } from '@skydrop/db';
import { useCancelOrder } from '@/lib/api-hooks';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { FormField, Select, Textarea } from '@/components/ui/form';
import { Modal, ModalFooter } from '@/components/ui/modal';

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

/**
 * Order actions panel — the sane admin cancel surface (CP2 commit 9).
 * God-mode override lands in commit 10 alongside this.
 *
 * Sane cancel = `CANCELLED_BY_ADMIN` via the matrix-guarded
 * `transitionStatus`. Whether the transition is legal from the
 * current state is the SERVER'S call (the matrix lives there); the
 * UI presents the action when the order isn't already in a clearly-
 * terminal state, and surfaces the server's verdict (incl.
 * STALE_ORDER_STATUS / NOOP_TRANSITION / INVALID_TRANSITION) verbatim
 * if it rejects. FE-2: we don't reimplement the state machine
 * client-side.
 */
export function OrderActionsPanel({
  orderId,
  orderNumber,
  status,
}: {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
}): ReactElement {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState<OrderCancellationReason>(
    OrderCancellationReason.OTHER,
  );
  const [note, setNote] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const cancel = useCancelOrder(orderId);

  const inTerminalState = TERMINAL_STATUSES.includes(status);

  function close(): void {
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
      close();
    } catch (err) {
      if (err instanceof ApiError && typeof err.body === 'object' && err.body !== null) {
        const body = err.body as { message?: unknown; code?: unknown };
        const msg = typeof body.message === 'string' ? body.message : err.message;
        const code = typeof body.code === 'string' ? body.code : null;
        // STALE_ORDER_STATUS / NOOP_TRANSITION / INVALID_TRANSITION all
        // land here from OrderWriteService.transitionStatus when the
        // matrix rejects. The user sees what the SERVER decided —
        // we don't pre-empt with a client-side matrix copy.
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
        subtitle="State-machine-guarded transitions. The server enforces the legal moves; the UI shows the action and surfaces the server's verdict."
      />
      <CardBody>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="destructive"
            size="md"
            disabled={inTerminalState || cancel.isPending}
            onClick={() => setCancelOpen(true)}
            title={
              inTerminalState
                ? `Already in a terminal state (${status.toLowerCase()})`
                : 'Cancel via the matrix (releases stock if reserved)'
            }
          >
            Cancel order
          </Button>
          {/* CP2.10 inserts the God-mode override button here. */}
        </div>
        {inTerminalState && (
          <div className="text-text-faint text-xs mt-2">
            This order is in a terminal state; further sane lifecycle
            actions aren&apos;t available. Use god-mode override (CP2.10) for
            extraordinary corrections.
          </div>
        )}
      </CardBody>

      <Modal
        open={cancelOpen}
        onOpenChange={(o) => !o && close()}
        title={
          <>
            Cancel order <span className="font-mono">{orderNumber}</span>?
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
          <Button variant="ghost" size="md" onClick={close} disabled={cancel.isPending}>
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
    </Card>
  );
}
