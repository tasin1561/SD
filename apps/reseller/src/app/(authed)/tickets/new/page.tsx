'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, type ReactElement } from 'react';
import { LoadingState, PageHeader } from '@skydrop/ui/components';
import { useRaiseStoreDispute, useRaiseStoreSkydropIssue } from '@/lib/ticket-hooks';
import { NewTicketForm, type TicketAudience } from './_components/new-ticket-form';

/**
 * RS-7 + the 2026-09-16 Skydrop issue — raising something about one of
 * this store's orders, with the seller or with us. Which of the two it
 * is decides the endpoint, and nothing else about the form changes.
 */
export default function NewTicketPage(): ReactElement {
  return (
    <Suspense fallback={<LoadingState label="Loading" rows={2} />}>
      <NewTicket />
    </Suspense>
  );
}

function audienceParam(value: string | null): TicketAudience {
  return value === 'skydrop' ? 'skydrop' : 'seller';
}

function NewTicket(): ReactElement {
  const params = useSearchParams();
  const router = useRouter();
  const raiseDispute = useRaiseStoreDispute();
  const raiseIssue = useRaiseStoreSkydropIssue();
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Raise a ticket"
        subtitle="About one of your orders — with your seller, or with Skydrop. Choose below; they go to different people."
      />
      <NewTicketForm
        initialOrderId={params?.get('orderId') ?? ''}
        // The order page links here already knowing which one is meant,
        // so somebody arriving from it does not have to choose twice.
        initialAudience={audienceParam(params?.get('with') ?? null)}
        pending={raiseDispute.isPending || raiseIssue.isPending}
        submit={({ audience, ...body }) =>
          audience === 'skydrop' ? raiseIssue.mutateAsync(body) : raiseDispute.mutateAsync(body)
        }
        onDone={(id) => router.push(`/tickets/${id}`)}
      />
    </div>
  );
}
