'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  Button,
  Card,
  EarlyReviewStatusBadge,
  EmptyState,
  ErrorNote,
  FormField,
  Ident,
  Modal,
  ModalFooter,
  Num,
  PageHeader,
  Select,
  SkeletonRows,
  Stat,
  TBody,
  Table,
  Td,
  Textarea,
  THead,
  Th,
  Toolbar,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { EarlyReservationReviewStatus } from '@skydrop/db';
import { useDecideHoldReview, useHoldReviews, type ReviewView } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Held stock awaiting the seller's call.
 *
 * When an order comes in, stock can be held immediately — before anyone
 * has spoken to the customer. If the call centre then exhausts its
 * attempts without reaching them, that stock is still held against an
 * order that may never happen, and only the seller can say whether to
 * keep holding it.
 *
 * Doing nothing has a cost, so the screen leads with how much is held.
 */
export function HoldReviewsIndex(): ReactElement {
  const [status, setStatus] = useState<string>(EarlyReservationReviewStatus.OPEN);
  const [selected, setSelected] = useState<ReviewView | null>(null);
  const list = useHoldReviews(status === '' ? {} : { status });

  const rows = list.data ?? [];
  const openRows = rows.filter(
    (r) => r.status === EarlyReservationReviewStatus.OPEN,
  );
  const heldUnits = openRows.reduce((sum, r) => sum + r.heldQty, 0);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Held stock"
        subtitle="Orders where we held your stock at placement but could not reach the customer. Release it, or ask us to keep trying."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Stat
          label="Units held pending your decision"
          value={list.isLoading ? '—' : <Num value={heldUnits} />}
          tone={heldUnits > 0 ? 'warn' : 'good'}
          hint="Unavailable to other orders until you decide"
        />
        <Stat
          label="Awaiting you"
          value={list.isLoading ? '—' : openRows.length}
          hint="Orders needing a call"
        />
      </div>

      <Toolbar>
        <label className="text-text-muted text-xs" htmlFor="hold-status">
          Status
        </label>
        <Select
          id="hold-status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-64"
        >
          <option value="">All</option>
          {Object.values(EarlyReservationReviewStatus).map((s) => (
            <option key={s} value={s}>
              {humanise(s)}
            </option>
          ))}
        </Select>
      </Toolbar>

      {list.isError ? (
        <Card className="rounded-t-none border-t-0 p-3">
          <ErrorNote
            message={list.error?.message ?? 'Failed to load held stock.'}
            retry={() => void list.refetch()}
          />
        </Card>
      ) : list.isLoading ? (
        <Card className="rounded-t-none border-t-0">
          <SkeletonRows rows={3} cols={5} />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="rounded-t-none border-t-0">
          <EmptyState
            bare
            title={
              status === EarlyReservationReviewStatus.OPEN
                ? 'Nothing waiting on you'
                : 'No matching reviews'
            }
            description={
              status === EarlyReservationReviewStatus.OPEN
                ? 'No stock is being held against an unreachable customer right now.'
                : 'Try a different status.'
            }
          />
        </Card>
      ) : (
        <Table wrapperClassName="rounded-t-none border-t-0">
          <THead>
            <Tr>
              <Th>Order</Th>
              <Th align="right">Units held</Th>
              <Th align="right">Calls made</Th>
              <Th>Status</Th>
              <Th align="right">Decision</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <Link
                    href={`/orders/${r.orderId}`}
                    className="text-accent hover:underline"
                  >
                    <Ident value={`${r.orderId.slice(0, 8)}…`} />
                  </Link>
                  <div className="text-text-faint mt-0.5 text-xs">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </div>
                </Td>
                <Td align="right">
                  <Num value={r.heldQty} />
                </Td>
                <Td align="right">
                  <Num value={r.attemptCount} />
                </Td>
                <Td>
                  <EarlyReviewStatusBadge status={r.status} />
                </Td>
                <Td align="right">
                  {r.status === EarlyReservationReviewStatus.OPEN ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSelected(r)}
                    >
                      Decide
                    </Button>
                  ) : (
                    <span className="text-text-faint text-xs">
                      {r.resolvedAt === null
                        ? '—'
                        : new Date(r.resolvedAt).toLocaleDateString()}
                    </span>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      <DecideModal review={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function DecideModal({
  review,
  onClose,
}: {
  readonly review: ReviewView | null;
  readonly onClose: () => void;
}): ReactElement {
  const toast = useToast();
  const decide = useDecideHoldReview();
  const [decision, setDecision] = useState<'RELEASE' | 'REQUEST_MORE_ATTEMPTS'>(
    'RELEASE',
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (review === null) return;
    setError(null);
    try {
      const result = await decide.mutateAsync({
        reviewId: review.id,
        decision,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      toast.success(
        decision === 'RELEASE'
          ? `${review.heldQty} unit${review.heldQty === 1 ? '' : 's'} released back to available stock.`
          : result.orderMoved
            ? 'We will keep trying to reach the customer.'
            : 'Recorded. The order had already moved on, so calling did not restart.',
      );
      setNote('');
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal
      open={review !== null}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          onClose();
        }
      }}
      size="md"
      title="Keep holding this stock?"
      description={
        review === null ? undefined : (
          <>
            We held {review.heldQty} unit
            {review.heldQty === 1 ? '' : 's'} when this order came in, and have tried
            the customer {review.attemptCount} time
            {review.attemptCount === 1 ? '' : 's'} without reaching them.
          </>
        )
      }
    >
      <div className="space-y-3">
        <fieldset>
          <legend className="sr-only">Decision</legend>
          <div className="space-y-2">
            <label className="border-border hover:bg-surface-hover flex cursor-pointer items-start gap-2 rounded-[var(--radius-2)] border px-3 py-2">
              <input
                type="radio"
                name="hold-decision"
                checked={decision === 'RELEASE'}
                onChange={() => setDecision('RELEASE')}
                className="mt-1"
              />
              <span>
                <span className="text-text-strong block text-sm">Release the stock</span>
                <span className="text-text-muted block text-xs leading-relaxed">
                  Returns the units to available stock so other orders can use them.
                  This order stays closed.
                </span>
              </span>
            </label>

            <label className="border-border hover:bg-surface-hover flex cursor-pointer items-start gap-2 rounded-[var(--radius-2)] border px-3 py-2">
              <input
                type="radio"
                name="hold-decision"
                checked={decision === 'REQUEST_MORE_ATTEMPTS'}
                onChange={() => setDecision('REQUEST_MORE_ATTEMPTS')}
                className="mt-1"
              />
              <span>
                <span className="text-text-strong block text-sm">Keep trying</span>
                <span className="text-text-muted block text-xs leading-relaxed">
                  We keep the hold and put the order back in the call queue. The units
                  stay unavailable to your other orders in the meantime.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        <FormField label="Note" htmlFor="hold-note" hint="Optional.">
          <Textarea
            id="hold-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>

        {error !== null && <ErrorNote message={error} />}
      </div>

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          disabled={decide.isPending}
          onClick={() => void submit()}
        >
          {decide.isPending
            ? 'Saving…'
            : decision === 'RELEASE'
              ? 'Release stock'
              : 'Keep trying'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function humanise(value: string): string {
  const lower = value.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
