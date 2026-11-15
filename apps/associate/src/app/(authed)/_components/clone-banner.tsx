'use client';

import type { ReactElement } from 'react';
import { useT } from '@/i18n/client';
import type { CloneState } from '@/lib/clone-order-hooks';
import { Notice } from './parts';

/** What the "Clone order" prefill tells the person at the top of the order form. */
export function CloneBanner({ clone }: { readonly clone: CloneState }): ReactElement | null {
  const t = useT();
  if (!clone.active) return null;
  if (clone.notFound)
    return (
      <Notice tone="warn" role="alert">
        {t('cloneOrder.notFound')}
      </Notice>
    );
  if (clone.failed)
    return (
      <Notice tone="warn" role="alert">
        {t('cloneOrder.failed')}
      </Notice>
    );
  if (clone.seed === null)
    return (
      <Notice tone="info" role="status">
        {t('cloneOrder.loading')}
      </Notice>
    );
  const seed = clone.seed;
  return (
    <>
      <Notice
        tone="info"
        role="status"
        title={t('cloneOrder.title', { order: seed.sourceOrderNumber })}
      >
        {t('cloneOrder.body')}
      </Notice>
      {seed.dropped.length > 0 && (
        <Notice tone="warn" role="status">
          {t('cloneOrder.dropped', { skus: seed.dropped.join(', ') })}
        </Notice>
      )}
      {seed.repriced.length > 0 && (
        <Notice tone="warn" role="status">
          {t('cloneOrder.repriced', { skus: seed.repriced.join(', ') })}
        </Notice>
      )}
    </>
  );
}
