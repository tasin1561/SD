'use client';

import type { ReactElement } from 'react';
import type { OrderChargeView } from '@skydrop/api-client';
import { useOrderCharges } from '@/lib/api-hooks';
import { verdict } from '@/i18n/verdict';
import { Money } from '@skydrop/ui/components';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { Receipt } from 'lucide-react';
import './orders.css';
import { useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/catalog';

/**
 * Seller order-charges section (Module 17). Reads from
 * /seller/orders/:id/charges (server filters to
 * `isVisibleToSeller=true`). Lines render in `displayOrder`. Total
 * is the SUM of `totalAmountInr` across visible lines.
 *
 * When no charges are persisted (Phase 1A: the M15 fast-follow has
 * not landed at the order-create hook), shows the standard empty
 * state with the explanatory copy — the admin compute action can
 * populate them retroactively.
 *
 * ── REDESIGN (2026-11-12) ───────────────────────────────────────────
 * Rows are label-left, amount-right at every width (a two-column table
 * on a 320px phone was the problem, not the cure), the Total last and
 * larger. The sub-label is the charge's STATE in a word ("Estimated");
 * the exact charge type is in the row's title.
 */
const STATUS_WORD: Readonly<Record<string, MessageKey>> = {
  ESTIMATED: 'orderPage.charge.estimated',
  CONFIRMED: 'orderPage.charge.confirmed',
  FINAL: 'orderPage.charge.final',
  DISPUTED: 'orderPage.charge.disputed',
  ADJUSTED: 'orderPage.charge.adjusted',
};

export function OrderChargesSection({ orderId }: { orderId: string }): ReactElement {
  const t = useT();
  const charges = useOrderCharges(orderId);

  if (charges.isLoading) {
    return <SkeletonRows rows={4} cols={2} label={t('ordersParts.loadingCharges')} />;
  }
  if (charges.isError) {
    return (
      <ErrorState
        message={verdict(charges.error, t, t('ordersParts.failedToLoadCharges'))}
        retry={() => void charges.refetch()}
      />
    );
  }
  if (!charges.data || charges.data.length === 0) {
    return (
      <EmptyState
        bare
        icon={<Receipt size={20} />}
        title={t('ordersParts.noChargesPersistedYet')}
        description={t('ordersParts.pricingBreakdownsAppearHere')}
      />
    );
  }

  const total = charges.data.reduce((sum, c) => sum + Number(c.totalAmountInr), 0);

  return (
    <ul className="cod-charges" aria-label={t('ordersParts.charges')}>
      {charges.data.map((c) => (
        <ChargeRow key={c.id} charge={c} />
      ))}
      <li className="cod-charges__row cod-charges__total">
        <span className="cod-charges__label">{t('ordersParts.total')}</span>
        <span className="cod-charges__amt">
          <Money amount={total} size="md" />
        </span>
      </li>
    </ul>
  );
}

function ChargeRow({ charge }: { charge: OrderChargeView }): ReactElement {
  const t = useT();
  const word = STATUS_WORD[charge.status];
  return (
    <li
      className="cod-charges__row"
      title={`${charge.type.toLowerCase().replace(/_/g, ' ')} · ${charge.status.toLowerCase()}`}
    >
      <span className="cod-charges__label">
        <span>{charge.description ?? humanizeType(charge.type)}</span>
        <span className="cod-charges__sub">
          {word === undefined ? charge.status.toLowerCase() : t(word)}
        </span>
      </span>
      <span className="cod-charges__amt">
        <Money amount={charge.totalAmountInr} />
      </span>
    </li>
  );
}

function humanizeType(type: string): string {
  return type
    .toLowerCase()
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}
