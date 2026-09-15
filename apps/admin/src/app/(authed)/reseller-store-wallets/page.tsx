import { Suspense, type ReactElement } from 'react';
import { LoadingState } from '@skydrop/ui/components';
import { ResellerStoreWalletsIndex } from './_components/reseller-store-wallets-index';

export default function ResellerStoreWalletsPage(): ReactElement {
  // The queues read `?storeId=` (useSearchParams), which needs a boundary.
  return (
    <Suspense fallback={<LoadingState label="Loading store wallet queues" rows={4} />}>
      <ResellerStoreWalletsIndex />
    </Suspense>
  );
}
