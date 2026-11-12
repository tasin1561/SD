'use client';

import type { ReactElement } from 'react';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { useT } from '@/i18n/client';

/**
 * The loading shape of the order page: the same header bar, facts row,
 * summary, stepper and two-column grid as the real thing, so nothing jumps
 * when the order arrives. Announced once as loading; the blocks are inert.
 */
export function OrderSkeleton(): ReactElement {
  const t = useT();
  const card = (rows: number, key: string): ReactElement => (
    <div className="cod-card cod-card--skel" key={key}>
      <div className="cod-card__head">
        <Skeleton width={28} height={28} rounded="md" />
        <div className="cod-card__titles">
          <Skeleton width="40%" height={18} />
          <Skeleton width="65%" height={14} />
        </div>
      </div>
      <div className="cod-card__body cod-skel__rows">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} height={16} width={i % 2 === 0 ? '90%' : '70%'} />
        ))}
      </div>
    </div>
  );
  return (
    <div
      className="cod-skel"
      role="status"
      aria-busy="true"
      aria-label={t('orderDetail.loadingOrder')}
    >
      <div className="cod-head">
        <div className="cod-bar">
          <Skeleton width={44} height={44} rounded="md" />
          <Skeleton width={190} height={24} />
          <Skeleton width={120} height={28} rounded="full" />
        </div>
        <div className="cod-meta">
          <Skeleton width="min(100%, 520px)" height={18} />
          <Skeleton width="min(100%, 360px)" height={44} rounded="md" />
        </div>
      </div>
      <Skeleton width="min(100%, 420px)" height={20} />
      <div className="cod-stepper cod-skel__stepper">
        <Skeleton height={64} rounded="md" />
      </div>
      <div className="cod-grid">
        <div className="cod-main">
          {card(5, 'a')}
          {card(4, 'b')}
        </div>
        <div className="cod-side">
          {card(5, 'c')}
          {card(3, 'd')}
        </div>
      </div>
    </div>
  );
}
