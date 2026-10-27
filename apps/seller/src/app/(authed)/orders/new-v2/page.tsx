'use client';

import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useOrderPageV2Enabled } from '@/lib/address-check-hooks';
import { NewOrderForm } from './_components/new-order-form';
import { useT } from '@/i18n/client';

/**
 * Manual order entry, version 2 — the same form with live address
 * checking from Solustation Address.
 *
 * A COPY of `/orders/new`, which is untouched and stays the page every
 * client uses until the audience flag says otherwise. Rolling back is
 * setting `orders.page_v2_audience` to `STAFF` or `OFF`; no deploy, and
 * the old page is still there because it was never edited.
 *
 * ── THE HIDING HERE IS COSMETIC (FE-2) ───────────────────────────────
 * `notFound()` keeps the route out of sight for anyone outside the
 * pilot, and that is a UX nicety, not the boundary. The boundary is the
 * API: every address-check route answers 404 to an account the flag
 * does not cover, so a hand-rolled request reaches nothing. Were this
 * check the only thing standing between a seller and a live billable
 * integration, it would be worth nothing at all.
 *
 * NOT FOUND rather than a "you are not in the pilot" page, deliberately:
 * telling every client that a better order page exists and they cannot
 * have it invites a question we do not want to answer per account.
 */
export default function NewOrderV2Page(): ReactElement {
  const t = useT();
  const gate = useOrderPageV2Enabled();

  // While we do not yet know, show the shape of a page rather than
  // either half of the answer — flashing the form and then 404ing is
  // worse than a moment of skeleton, and 404ing first would hide the
  // page from the pilot on every slow connection.
  if (gate.isPending)
    return <SkeletonRows rows={6} cols={2} label={t('orderNew.loadingTheOrderForm')} />;

  // A failed check is NOT a reason to show an unproven page. Same
  // fail-closed rule the server gate uses, for the same reason.
  if (gate.data?.enabled !== true) notFound();

  return <NewOrderForm />;
}
