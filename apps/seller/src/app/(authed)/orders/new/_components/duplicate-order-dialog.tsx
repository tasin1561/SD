'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { Button, Modal } from '@skydrop/ui/components';

/**
 * "You already have an order to this customer that hasn't shipped."
 *
 * The decision the seller is making is not "do I want to continue" — it
 * is "is this the same order I already entered?". So the dialog leads
 * with the existing orders and what is in them, and the confirm button
 * stays inert until they have said they looked.
 *
 * It never refuses. A second genuine order to one customer is ordinary,
 * and a system that blocked it would train sellers to work around it.
 */

export interface DuplicateCandidate {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: string;
  readonly placedAt: string;
  readonly itemCount: number;
  readonly valueInr: string | null;
  readonly recipientName: string;
  /** Contains at least one of the same SKUs as the order being placed. */
  readonly sharesItems: boolean;
}

export function DuplicateOrderDialog({
  open,
  candidates,
  busy,
  onCancel,
  onConfirm,
}: {
  readonly open: boolean;
  readonly candidates: ReadonlyArray<DuplicateCandidate>;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): ReactElement {
  const [acknowledged, setAcknowledged] = useState(false);
  const anySharedItems = candidates.some((c) => c.sharesItems);

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setAcknowledged(false);
          onCancel();
        }
      }}
      title="This customer already has an order waiting"
      tone="critical"
    >
      <div className="space-y-4">
        <p className="text-text-muted text-sm">
          {candidates.length === 1 ? 'An order' : `${candidates.length} orders`} to this number
          {anySharedItems ? ' — including the same items — ' : ' '}
          {candidates.length === 1 ? 'has' : 'have'} not been packed yet. If this is the same order
          entered twice, cancel and check.
        </p>

        <ul className="divide-border border-border divide-y rounded-[5px] border">
          {candidates.map((c) => (
            <li key={c.orderId} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <Link
                  href={`/orders/${c.orderId}`}
                  target="_blank"
                  className="font-mono text-sm hover:underline"
                >
                  {c.orderNumber}
                </Link>
                <div className="text-text-faint text-xs">
                  {c.recipientName} · {c.itemCount} item{c.itemCount === 1 ? '' : 's'} ·{' '}
                  {new Date(c.placedAt).toLocaleDateString()}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-text-muted text-xs">
                  {c.status.replaceAll('_', ' ').toLowerCase()}
                </div>
                {c.sharesItems && (
                  <div className="text-[var(--status-pending-fg)] text-xs">same items</div>
                )}
              </div>
            </li>
          ))}
        </ul>

        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          <span className="text-text-muted">
            I have checked — this is a separate order and should ship as its own parcel.
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="destructive"
            size="md"
            disabled={!acknowledged || busy}
            onClick={onConfirm}
          >
            {busy ? 'Placing…' : 'Place it anyway'}
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => {
              setAcknowledged(false);
              onCancel();
            }}
          >
            Cancel and check
          </Button>
        </div>
      </div>
    </Modal>
  );
}
