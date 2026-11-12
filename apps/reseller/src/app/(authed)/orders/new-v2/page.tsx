'use client';

import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useOrderPageV2Enabled } from '@/lib/address-check-hooks';
import { useT } from '@/i18n/client';
import { NewStoreOrderPageForm } from './v2-form';

/**
 * Order page v2 — the same form with live address checking. Since
 * `/orders/new` became the chooser this route is a direct link to the
 * v2 form only; the form itself lives in `./v2-form`.
 *
 * The `notFound()` below hides this route from anyone outside the pilot,
 * and that hiding is COSMETIC (FE-2): the API answers 404 on every
 * address-check route for an account the flag does not cover, which is
 * the real boundary. A failed check is not a reason to show an unproven
 * page — the same fail-closed rule the server gate uses.
 */
export default function NewStoreOrderPageV2(): ReactElement {
  const t = useT();
  const gate = useOrderPageV2Enabled();
  if (gate.isPending) return <SkeletonRows rows={6} cols={2} label={t('neworder.loadingForm')} />;
  if (gate.data?.enabled !== true) notFound();
  return <NewStoreOrderPageForm />;
}
