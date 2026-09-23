import { Suspense, type ReactElement } from 'react';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { ResellerStoreWalletsIndex } from './_components/reseller-store-wallets-index';

export default function ResellerStoreWalletsPage(): ReactElement {
  // The queues read `?storeId=` (useSearchParams), which needs a boundary.
  return (
    <Suspense fallback={<SkeletonRows rows={4} cols={6} label="Loading store wallet queues" />}>
      <ResellerStoreWalletsIndex />
    </Suspense>
  );
}
