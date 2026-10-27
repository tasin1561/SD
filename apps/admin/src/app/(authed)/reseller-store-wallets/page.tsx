import { Suspense, type ReactElement } from 'react';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { ResellerStoreWalletsIndex } from './_components/reseller-store-wallets-index';
import { getT } from '@/i18n/server';

export default async function ResellerStoreWalletsPage(): Promise<ReactElement> {
  const { t } = await getT();
  // The queues read `?storeId=` (useSearchParams), which needs a boundary.
  return (
    <Suspense
      fallback={
        <SkeletonRows
          rows={4}
          cols={6}
          label={t('resellerStoreWalletsPage.loadingStoreWalletQueues')}
        />
      }
    >
      <ResellerStoreWalletsIndex />
    </Suspense>
  );
}
