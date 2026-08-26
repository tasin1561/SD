'use client';

import type { ReactElement } from 'react';
import { Card, CardBody, CardHeader, Money } from '@skydrop/ui/components';
import { useWalletTerms, type WalletTerm } from '@/lib/ops-hooks';

/**
 * The rules this wallet runs on.
 *
 * Every one of them decides an outcome the seller experiences — how much
 * they can take out, how often, when COD lands, what is charged. A rule
 * that only ever appears as a refusal is one they have to discover by
 * being refused.
 *
 * No edit affordance, and none exists behind it: these are set by us,
 * globally or per seller. A seller who could raise their own withdrawal
 * cap would not have one.
 */
/**
 * The two the seller OWNS, shown by PayoutScheduleCard as controls
 * rather than as facts. Listing them here as well would put a read-only
 * copy of a value directly below the switch that changes it — and the
 * two would disagree for as long as a refetch takes.
 */
const OWNED_BY_SELLER = new Set([
  'wallet.auto_withdraw_enabled',
  'wallet.auto_withdraw_hour_local',
]);

export function WalletTermsCard(): ReactElement | null {
  const terms = useWalletTerms();
  const items = (terms.data?.items ?? []).filter((t) => !OWNED_BY_SELLER.has(t.key));
  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Your limits"
        subtitle="Set by Skydrop and not editable here — shown so a limit is never a surprise. Ask us if one looks wrong for your account."
      />
      <CardBody>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {items.map((t) => (
            <div key={t.key} className="flex items-baseline justify-between gap-3 text-sm">
              <div className="min-w-0">
                <dt className="text-text-body">{t.label}</dt>
                {t.hint !== '' && <dd className="text-text-faint text-xs">{t.hint}</dd>}
              </div>
              <dd className="text-text-bright shrink-0 text-right">{format(t)}</dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}

/**
 * A raw setting value means nothing on its own: `1` is a count, `10` is
 * an hour, `2.50` is a percent and `0.00` is money. The kind travels
 * with the value from the server so the unit is never guessed here.
 */
function format(t: WalletTerm): ReactElement | string {
  if (t.value === '') return '—';
  switch (t.kind) {
    case 'INR':
      // Not converted: these are the thresholds the guards apply, and
      // they are applied in rupees.
      return <Money amount={t.value} currency="INR" convert={false} />;
    case 'PERCENT':
      return `${t.value}%`;
    case 'COUNT':
      return t.value;
    case 'HOUR': {
      const h = Number(t.value);
      if (!Number.isFinite(h)) return t.value;
      return `${String(h).padStart(2, '0')}:00`;
    }
    case 'BOOL':
      return t.value === 'true' || t.value === '1' ? 'On' : 'Off';
    default:
      // SETTLEMENT -> Settlement, PAY_NOW -> Pay now.
      return t.value
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/^./, (c) => c.toUpperCase());
  }
}
