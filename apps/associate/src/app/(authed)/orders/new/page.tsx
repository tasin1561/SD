'use client';

import type { ReactElement } from 'react';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useOrderPageV2Enabled } from '@/lib/address-check-hooks';
import { useT } from '@/i18n/client';
import { NewOrderPageForm } from '../new-v2/v2-form';
import { OldOrderForm } from './old-form';

/**
 * Order entry. Shows the v2 form (live address checking) when the
 * `orders.page_v2_audience` gate allows it, otherwise the original form.
 *
 * FAIL-CLOSED, inverted fallback: while the gate is pending we show a
 * skeleton (never a form that then swaps), and a failed or negative
 * check lands on the ORIGINAL form, never the unproven v2. The gate is
 * cosmetic routing (FE-2); the API 404s address-check routes for
 * accounts outside the audience.
 */
export default function NewOrderPage(): ReactElement {
  const t = useT();
  const gate = useOrderPageV2Enabled();
  if (gate.isPending) return <SkeletonRows rows={6} cols={2} label={t('neworder.loading')} />;
  if (gate.data?.enabled === true) return <NewOrderPageForm />;
  return <OldOrderForm />;
}
