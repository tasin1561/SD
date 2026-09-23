'use client';

import type { ReactElement } from 'react';
import { useOrderCustomerReputation } from '@/lib/api-hooks';
import './call-center.css';

/**
 * Who the agent is about to phone.
 *
 * This is the highest-leverage place the reputation figure appears. The
 * seller entering an order is optimistic by nature — it is their sale.
 * The agent on the phone is the gate, and they are deciding, in the next
 * sixty seconds, whether this parcel gets shipped at all.
 *
 * So it is a STRIP, not a card: one line, read at a glance while the
 * phone is ringing, sitting directly above the customer's details. An
 * agent mid-call will not open a panel.
 *
 * It says nothing for a first-time customer. Most calls are first-time
 * customers, and a strip that is always there saying "nothing known" is
 * a strip nobody reads on the call where it finally matters.
 *
 * Scoped, deliberately, to the same picture the SELLER would see: the
 * platform-wide counts plus that seller's own history. The agent is
 * acting on their behalf.
 */

const HIGH_RETURN_RATE = 30;
const ELEVATED_RETURN_RATE = 15;

export function CustomerRiskStrip({ orderId }: { readonly orderId: string }): ReactElement | null {
  const q = useOrderCustomerReputation(orderId);

  // A failed lookup is silent. The agent has a call to make and this is
  // advice; an error banner would be worse than the missing advice.
  if (q.isLoading || q.isError || !q.data) return null;

  const { platform, yours, riskLevel, riskNotes } = q.data;
  if (platform.totalOrders === 0) return null;

  const pct = platform.returnRatePercent === null ? null : Number(platform.returnRatePercent);
  const severe = pct !== null && pct >= HIGH_RETURN_RATE;
  const elevated = pct !== null && pct >= ELEVATED_RETURN_RATE;
  const flagged = riskLevel !== 'NONE';

  // Quiet unless there is something to say. A normal returning customer
  // gets a neutral line; only a real signal gets colour.
  const tone = severe || flagged ? 'critical' : elevated ? 'pending' : 'neutral';
  return (
    <div className="cc-risk" data-tone={tone} role={tone === 'critical' ? 'alert' : undefined}>
      <div className="cc-risk__line">
        {pct !== null ? (
          <span className="cc-risk__lead">
            <span className="sk-figure oo-strong">{platform.returnRatePercent}%</span> of this
            customer&apos;s parcels came back
          </span>
        ) : (
          <span className="cc-risk__lead">
            <span className="sk-figure">{platform.totalOrders}</span> previous order
            {platform.totalOrders === 1 ? '' : 's'}
          </span>
        )}
        <span className="cc-risk__note sk-figure">
          {platform.delivered} delivered · {platform.returned} returned
          {platform.refusedOnCall > 0 && ` · declined on a call ${platform.refusedOnCall}×`}
        </span>
        {yours.totalOrders > 0 && (
          <span className="oo-faint">({yours.totalOrders} with this seller)</span>
        )}
        {flagged && <span className="cc-risk__flag">Flagged {riskLevel.toLowerCase()}</span>}
      </div>
      {riskNotes !== null && riskNotes.trim().length > 0 && (
        <div className="cc-risk__note cc-risk__note--quote">{riskNotes}</div>
      )}
      {yours.openOrders.length > 1 && (
        <div className="cc-risk__note">
          {yours.openOrders.length} orders from this seller are open at once — worth asking whether
          they meant to place them all.
        </div>
      )}
    </div>
  );
}
