'use client';

import Link from 'next/link';
import { Copy } from 'lucide-react';
import type { ReactElement } from 'react';
import { Button } from '@skydrop/ui/app/button';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import '../../_components/orders.css';
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

function rateTone(pct: number): { tone: 'bad' | 'warn' | 'good'; label: string } {
  if (pct >= HIGH_RETURN_RATE) {
    return { tone: 'bad', label: 'Well above average' };
  }
  if (pct >= ELEVATED_RETURN_RATE) {
    return { tone: 'warn', label: 'Above average' };
  }
  return { tone: 'good', label: 'Normal' };
}

function OrderLine({ o }: { readonly o: CustomerOrderSummary }): ReactElement {
  return (
    <li>
      <Link href={`/orders/${o.orderId}`} className="ord-link sk-ident">
        {o.orderNumber}
      </Link>
      <span className="ord-faint">
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
      <div className="ord-card">
        <Skeleton width={192} height={16} />
      </div>
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
    <div className="ord-history" role="region" aria-label="This customer's history">
      <div className="ord-row ord-row--between">
        <span className="ord-strong">{customerName ?? 'Returning customer'}</span>
        {riskLevel !== 'NONE' && (
          <StatusChip kind="failed" label={`Flagged ${riskLevel.toLowerCase()}`} size="sm" />
        )}
      </div>

      {/* The rate first — it is the only figure that changes a decision. */}
      {tone !== null && pct !== null ? (
        <div className="ord-history__rate">
          <span className="ord-history__pct sk-figure" data-tone={tone.tone}>
            {platform.returnRatePercent}%
          </span>
          <span className="ord-p">
            came back — {platform.returned} of {platform.delivered + platform.returned} delivered
            attempts
          </span>
          <span className="ord-faint">({tone.label})</span>
        </div>
      ) : (
        <p className="ord-p">
          {platform.totalOrders} order{platform.totalOrders === 1 ? '' : 's'} across Skydrop — too
          few concluded to give a return rate yet.
        </p>
      )}

      <div className="ord-history__counts">
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
            <span className="ord-faint">(no shipping cost)</span>
          </span>
        )}
      </div>

      {riskNotes !== null && riskNotes.trim().length > 0 && (
        <p className="ord-quote">{riskNotes}</p>
      )}

      {yours.recentOrders.length > 0 && (
        <div>
          <span className="ord-faint">Your orders to this customer</span>
          <ul className="ord-mini-list">
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
        <div className="ord-history__fill">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={<Copy size={14} />}
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
            Use these delivery details
          </Button>
          <span className="ord-faint">
            {last.addressLine1}
            {last.postalCode === '' ? '' : ` · ${last.postalCode}`} — from {last.fromOrderNumber},{' '}
            {new Date(last.placedAt).toLocaleDateString('en-IN')}
          </span>
        </div>
      )}
    </div>
  );
}
