'use client';

import type { ReactElement } from 'react';
import { Info } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { useWalletTerms, type WalletTerm } from '@/lib/ops-hooks';
import './wallet.css';
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

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
  const t = useT();
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
      <SectionHeading title={t('wallet.yourLimits')} note={t('wallet.setBySkydropShown')} />
      <div className="wal-card">
        <ul className="wal-terms">
          {items.map((term) => (
            <li key={term.key} className="wal-term">
              <span className="wal-term__chip" aria-hidden>
                <Info size={13} />
              </span>
              <div className="wal-term__text">
                <div className="wal-term__label">{term.label}</div>
                {term.hint !== '' && <p className="wal-term__hint">{term.hint}</p>}
              </div>
              <div className="wal-term__value sk-figure">{format(term, t)}</div>
            </li>
          ))}
        </ul>
        <p className="wal-setting__desc">{t('wallet.askUsIfOne')}</p>
      </div>
    </section>
  );
}

/**
 * A raw setting value means nothing on its own: `1` is a count, `10` is
 * an hour, `2.50` is a percent and `0.00` is money. The kind travels
 * with the value from the server so the unit is never guessed here.
 */
function format(term: WalletTerm, t: Translate<MessageKey>): ReactElement | string {
  if (term.value === '') return '—';
  switch (term.kind) {
    case 'INR':
      // Not converted: these are the thresholds the guards apply, and
      // they are applied in rupees.
      return <Money amount={term.value} currency="INR" convert={false} />;
    case 'PERCENT':
      return `${term.value}%`;
    case 'COUNT':
      return term.value;
    case 'HOUR': {
      const h = Number(term.value);
      if (!Number.isFinite(h)) return term.value;
      return `${String(h).padStart(2, '0')}:00`;
    }
    case 'BOOL':
      return term.value === 'true' || term.value === '1' ? t('wallet.on') : t('wallet.off');
    default:
      // SETTLEMENT -> Settlement, PAY_NOW -> Pay now.
      return term.value
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/^./, (c) => c.toUpperCase());
  }
}
