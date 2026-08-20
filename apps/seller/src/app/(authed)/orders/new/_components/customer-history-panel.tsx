'use client';

import Link from 'next/link';
import { Copy } from 'lucide-react';
import type { ReactElement } from 'react';
import { Card, CardBody, Skeleton, Button } from '@skydrop/ui/components';
import { useCustomerLookup, type CustomerOrderSummary } from '@/lib/api-hooks';

/**
 * Who you are about to ship to.
 *
 * Appears beside the phone field the moment the number is complete. The
 * job is to answer one question in the second before the seller moves
 * on: is this parcel likely to come back?
 *
 * So the return RATE leads, not the order count — "14 orders" is
 * flattering and says nothing, "5 of 14 came back" is the number that
 * changes a decision. Nothing renders at all for a first-time customer:
 * an empty panel saying "no history" is noise on the majority of orders.
 *
 * The counts span every seller; the ORDER LIST below them does not. That
 * asymmetry is deliberate and is worth not quietly widening later — the
 * seller gets the risk without learning who else sells to this person.
 */

/** Above this, the parcel is more likely than not to be trouble. */
const HIGH_RETURN_RATE = 30;
const ELEVATED_RETURN_RATE = 15;

function rateTone(pct: number): { fg: string; label: string } {
  if (pct >= HIGH_RETURN_RATE) {
    return { fg: 'var(--status-rto-fg)', label: 'Well above average' };
  }
  if (pct >= ELEVATED_RETURN_RATE) {
    return { fg: 'var(--status-pending-fg)', label: 'Above average' };
  }
  return { fg: 'var(--status-delivered-fg)', label: 'Normal' };
}

function OrderLine({ o }: { readonly o: CustomerOrderSummary }): ReactElement {
  return (
    <li className="flex items-center justify-between gap-3 py-1">
      <Link href={`/orders/${o.orderId}`} className="font-mono text-xs hover:underline">
        {o.orderNumber}
      </Link>
      <span className="text-text-faint text-xs">
        {o.status.replaceAll('_', ' ').toLowerCase()} · {new Date(o.placedAt).toLocaleDateString()}
      </span>
    </li>
  );
}

export function CustomerHistoryPanel({
  phoneE164,
  onUseLastDetails,
}: {
  readonly phoneE164: string;
  /** Fill the recipient block from where this seller last sent to this
   *  number. Absent when the form has nothing to fill. */
  readonly onUseLastDetails?: (r: {
    name: string;
    addressLine1: string;
    addressLine2: string | null;
    landmark: string | null;
    postalCode: string;
  }) => void;
}): ReactElement | null {
  const q = useCustomerLookup(phoneE164);

  if (q.isLoading) {
    return (
      <Card>
        <CardBody>
          <Skeleton className="h-4 w-48" />
        </CardBody>
      </Card>
    );
  }
  // A failed lookup must never block order entry — it is advice, not a
  // gate. Silence is the right failure here.
  if (q.isError || !q.data) return null;

  const { platform, yours, riskLevel, riskNotes, customerName } = q.data;
  // First-time customer: say nothing rather than say "nothing known".
  if (platform.totalOrders === 0) return null;

  const pct = platform.returnRatePercent === null ? null : Number(platform.returnRatePercent);
  const tone = pct === null ? null : rateTone(pct);

  const last = yours.lastKnownRecipient;

  return (
    // Ringed and tinted: a match is a FINDING, and the panel appears
    // mid-form where a plain card reads as more chrome. The accent is
    // the neutral one — a returning customer is not a warning, and the
    // risk tone below is what carries alarm when there is any.
    <Card className="border-accent/40 bg-accent/5 border">
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-text-bright text-sm font-medium">
            {customerName ?? 'Returning customer'}
          </span>
          {riskLevel !== 'NONE' && (
            <span className="text-critical text-xs font-medium">
              Flagged {riskLevel.toLowerCase()}
            </span>
          )}
        </div>

        {/* The rate first — it is the only figure that changes a decision. */}
        {tone !== null && pct !== null ? (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums" style={{ color: tone.fg }}>
              {platform.returnRatePercent}%
            </span>
            <span className="text-text-muted text-sm">
              came back — {platform.returned} of {platform.delivered + platform.returned} delivered
              attempts
            </span>
            <span className="text-text-faint text-xs">({tone.label})</span>
          </div>
        ) : (
          <div className="text-text-muted text-sm">
            {platform.totalOrders} order{platform.totalOrders === 1 ? '' : 's'} across Skydrop — too
            few concluded to give a return rate yet.
          </div>
        )}

        <div className="text-text-muted grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          <span>
            Across Skydrop: {platform.totalOrders} orders · {platform.delivered} delivered ·{' '}
            {platform.returned} returned
          </span>
          <span>
            With you: {yours.totalOrders} orders · {yours.delivered} delivered · {yours.returned}{' '}
            returned
          </span>
          {platform.refusedOnCall > 0 && (
            <span>
              Declined on the confirmation call {platform.refusedOnCall}×{' '}
              <span className="text-text-faint">(no shipping cost)</span>
            </span>
          )}
        </div>

        {riskNotes !== null && riskNotes.trim().length > 0 && (
          <div className="text-text-muted border-border border-l-2 pl-3 text-xs italic">
            {riskNotes}
          </div>
        )}

        {yours.recentOrders.length > 0 && (
          <div>
            <div className="text-text-faint mb-1 text-xs">Your orders to this customer</div>
            <ul className="divide-border divide-y">
              {yours.recentOrders.slice(0, 5).map((o) => (
                <OrderLine key={o.orderId} o={o} />
              ))}
            </ul>
          </div>
        )}

        {last !== null && onUseLastDetails !== undefined && (
          // Offered only when there IS something to fill: a customer who
          // has ordered across Skydrop but never from this seller has no
          // address we may hand over.
          <div className="border-border/60 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                onUseLastDetails({
                  name: last.name,
                  addressLine1: last.addressLine1,
                  addressLine2: last.addressLine2,
                  landmark: last.landmark,
                  postalCode: last.postalCode,
                })
              }
            >
              <Copy size={12} /> Use these delivery details
            </Button>
            <span className="text-text-muted text-xs">
              {last.addressLine1}
              {last.postalCode === '' ? '' : ` · ${last.postalCode}`} — from {last.fromOrderNumber},{' '}
              {new Date(last.placedAt).toLocaleDateString('en-IN')}
            </span>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
