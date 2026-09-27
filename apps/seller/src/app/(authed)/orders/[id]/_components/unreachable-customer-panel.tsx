'use client';

import { useState, type ReactElement } from 'react';
import { Gavel, PhoneOff } from 'lucide-react';
import { EarlyReservationReviewStatus } from '@skydrop/db';
import { Button } from '@skydrop/ui/app/button';
import { Notice } from '../../_components/orders-parts';
import { HoldDecisionDialog } from '@/components/hold-decision-dialog';
import { useHoldReviews } from '@/lib/ops-hooks';
import { can } from '@/lib/page-access';
import { useSellerIdentity } from '@skydrop/auth/client';

/**
 * "We rang your customer and nobody answered" — ON THE ORDER, where the
 * seller already is.
 *
 * ── WHY THIS EXISTS (2026-09-27) ─────────────────────────────────────
 * R5b pauses an order at AWAITING_SELLER_DECISION when the call cap is
 * reached and only the seller can say what happens next. Everything
 * pointed them HERE — `/needs-attention` said in as many words "open the
 * order — from there you can ask us to call again" — and the order page
 * offered Cancel and nothing else, because the re-attempt request is
 * gated on the rejected statuses. The one screen that could answer it
 * was `/holds`, titled "Held stock", under the Stock nav group.
 *
 * ── ONE DIALOG, TWO MOUNTS ───────────────────────────────────────────
 * `HoldDecisionDialog` is shared with the register page, and the write
 * is the SAME `PATCH /seller/early-reservation-reviews/:id` — no second
 * endpoint, no second hook, no second copy of what "let it go" means.
 *
 * ── WHERE THE REVIEW ID COMES FROM ───────────────────────────────────
 * The seller order payload does not carry it (nothing review-shaped is
 * on `OrderView`), so this reads the seller's OPEN reviews — the list
 * endpoint that already exists — and matches on `orderId`. That is
 * cheaper than an API change and bounded by construction: an open review
 * lives at most as long as the TTL sweep allows, so the list is small.
 *
 * ── WHY IT STILL RENDERS WITHOUT ONE ─────────────────────────────────
 * The panel is driven by the ORDER's status, not by the review, and it
 * explains the pause even when the list is unavailable — a seller who
 * lacks `holds.manage` (so the query never fires), or the visible
 * intermediate state where the sweep resolved the review but its order
 * transition did not land. Saying nothing there would leave a paused
 * order with no explanation anywhere.
 */
export function UnreachableCustomerPanel({
  orderId,
  orderNumber,
}: {
  readonly orderId: string;
  readonly orderNumber: string;
}): ReactElement {
  const identity = useSellerIdentity();
  // COSMETIC (FE-2): this decides whether we ASK, and whether the button
  // is offered. The server refuses the PATCH regardless.
  const mayDecide = identity !== null && can(identity, 'holds.manage');
  const reviews = useHoldReviews(
    { status: EarlyReservationReviewStatus.OPEN },
    { enabled: mayDecide },
  );
  const review = (reviews.data ?? []).find((r) => r.orderId === orderId) ?? null;
  const [open, setOpen] = useState(false);

  return (
    <>
      <Notice
        tone="warn"
        icon={<PhoneOff size={16} />}
        title="We could not reach your customer — this order is waiting on you"
      >
        <span className="ord-p">
          {review === null
            ? 'Our agents rang and nobody answered, so nothing more happens to this order until you decide whether we should keep trying.'
            : review.heldQty > 0
              ? `Our agents have tried ${review.attemptCount} time${review.attemptCount === 1 ? '' : 's'} without reaching anybody, and ${review.heldQty} unit${review.heldQty === 1 ? '' : 's'} of your stock ${review.heldQty === 1 ? 'is' : 'are'} held against this order in the meantime.`
              : `Our agents have tried ${review.attemptCount} time${review.attemptCount === 1 ? '' : 's'} without reaching anybody. Nothing more happens to this order until you decide.`}
        </span>
        {review !== null && (
          <span className="ord-faint">
            Raised {new Date(review.createdAt).toLocaleString('en-IN')}. If you leave it, we let the
            order go for you after a few days.
          </span>
        )}
        {mayDecide ? (
          review !== null ? (
            <span className="ord-notice__act">
              <Button
                variant="primary"
                size="sm"
                icon={<Gavel size={14} />}
                onClick={() => setOpen(true)}
              >
                Decide
              </Button>
            </span>
          ) : reviews.isLoading ? (
            <span className="ord-faint">Loading your decision…</span>
          ) : (
            // Either the decision was already answered (and the order is
            // catching up) or the list could not be read. Both are true
            // statements rather than a dead button.
            <span className="ord-faint">
              There is nothing here for you to answer — if this order is still paused in a few
              minutes, open Unreachable customers.
            </span>
          )
        ) : (
          <span className="ord-faint">
            Somebody on your team who manages unreachable customers has to answer this.
          </span>
        )}
      </Notice>

      <HoldDecisionDialog
        review={open ? review : null}
        orderNumber={orderNumber}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
