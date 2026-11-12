'use client';

import type { ReactElement } from 'react';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useOrderPageV2Enabled } from '@/lib/address-check-hooks';
import { useT } from '@/i18n/client';
import { NewOrderForm as NewOrderFormV2 } from '../new-v2/_components/new-order-form';
import { NewOrderForm } from './_components/new-order-form';

/**
 * Manual order entry. Shows the v2 form (live address checking) when the
 * `orders.page_v2_audience` gate allows it, otherwise the original form.
 *
 * FAIL-CLOSED, inverted fallback: a pending gate shows a skeleton (never
 * a form that then swaps), and a failed or negative check lands on the
 * ORIGINAL form, never the unproven v2. The gate is cosmetic routing
 * (FE-2); the API 404s address-check routes for accounts outside the
 * audience.
 *
 * The form posts to /seller/orders. "Save as draft" leaves the order in
 * DRAFT; "Submit for confirmation" additionally calls /:id/submit. The
 * page header lives INSIDE the form (its action slot carries the busy
 * state).
 */
export default function NewOrderPage(): ReactElement {
  const t = useT();
  const gate = useOrderPageV2Enabled();
  if (gate.isPending)
    return <SkeletonRows rows={6} cols={2} label={t('orderNew.loadingTheOrderForm')} />;
  if (gate.data?.enabled === true) return <NewOrderFormV2 />;
  return <NewOrderForm />;
}
