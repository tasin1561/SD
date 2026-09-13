import type { ReactElement } from 'react';
import { prefillFromSearchParams } from '@/lib/adjustment-prefill';
import { AdjustmentsIndex } from './_components/adjustments-index';

/**
 * `?sellerId=&variantId=&binId=&batchId=&reason=` opens the new-adjustment
 * form already filled — the "Adjust" link on a bin's contents, which is how
 * a unit kept aside in the Damaged bin goes back to the seller.
 */
export default async function AdjustmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    sellerId?: string;
    variantId?: string;
    binId?: string;
    batchId?: string;
    reason?: string;
  }>;
}): Promise<ReactElement> {
  const prefill = prefillFromSearchParams(await searchParams);
  return <AdjustmentsIndex prefill={prefill} />;
}
