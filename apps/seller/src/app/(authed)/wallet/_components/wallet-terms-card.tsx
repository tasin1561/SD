'use client';

import type { ReactElement } from 'react';
import { Info } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { useWalletTerms, type WalletTerm } from '@/lib/ops-hooks';
import './wallet.css';

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
 * The two the seller OWNS, shown by WithdrawalScheduleCard as controls
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

  /*
    Each rule is an INFO row — an info chip, what it is, why it exists
    and the figure — never a KPI card: these are thresholds, not
    positions, and a card here would put a rule where the console puts
    a balance.
  */
  return (
    <section className="wal-section">
      <SectionHeading
        title="Your limits"
        note="Set by Skydrop — shown so a limit is never a surprise."
      />
      <div className="wal-card">
        <ul className="wal-terms">
          {items.map((t) => (
            <li key={t.key} className="wal-term">
              <span className="wal-term__chip" aria-hidden>
                <Info size={13} />
              </span>
              <div className="wal-term__text">
                <div className="wal-term__label">{t.label}</div>
                {t.hint !== '' && <p className="wal-term__hint">{t.hint}</p>}
              </div>
              <div className="wal-term__value sk-figure">{format(t)}</div>
            </li>
          ))}
        </ul>
        <p className="wal-setting__desc">Ask us if one of these looks wrong for your account.</p>
      </div>
    </section>
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
