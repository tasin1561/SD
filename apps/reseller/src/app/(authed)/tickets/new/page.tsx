'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, type ReactElement } from 'react';
import { LoadingState, PageHeader } from '@skydrop/ui/components';
import { useRaiseStoreDispute } from '@/lib/ticket-hooks';
import { NewDisputeForm } from './_components/new-dispute-form';

/** RS-7 — raise a dispute with the seller about one of this store's orders. */
export default function NewDisputePage(): ReactElement {
  return (
    <Suspense fallback={<LoadingState label="Loading" rows={2} />}>
      <NewDispute />
    </Suspense>
  );
}

function NewDispute(): ReactElement {
  const params = useSearchParams();
  const router = useRouter();
  const raise = useRaiseStoreDispute();
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Raise a dispute"
        subtitle="The seller reads it, and Skydrop referees. If it is settled with money, it moves between your wallet and the seller’s."
      />
      <NewDisputeForm
        initialOrderId={params?.get('orderId') ?? ''}
        pending={raise.isPending}
        submit={(body) => raise.mutateAsync(body)}
        onDone={(id) => router.push(`/tickets/${id}`)}
      />
    </div>
  );
}
