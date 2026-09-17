'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, type ReactElement } from 'react';
import { LoadingState, PageHeader, useToast } from '@skydrop/ui/components';
import { useStoreIdentity } from '@skydrop/auth/client';
import { can } from '@/lib/page-access';
import { useStoreActionPolicy } from '@/lib/order-hooks';
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
  const toast = useToast();
  const me = useStoreIdentity();
  // Only to decide what to OFFER; the server refuses by name regardless.
  const policy = useStoreActionPolicy({ enabled: can(me, 'orders.view') });
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
        skydropMode={policy.data?.chaseSkydrop}
        submit={async ({ audience, ...body }) => {
          if (audience === 'seller') {
            const t = await raiseDispute.mutateAsync(body);
            return { kind: 'ticket', id: t.id };
          }
          // The REPLY says which happened, never the policy read earlier.
          const out = await raiseIssue.mutateAsync(body);
          return out.applied
            ? { kind: 'ticket', id: out.ticket.id }
            : { kind: 'held', orderId: out.request.orderId };
        }}
        onDone={(result) => {
          if (result.kind === 'ticket') {
            router.push(`/tickets/${result.id}`);
            return;
          }
          toast.success(
            'Sent to Seller staff to approve. It reaches Skydrop only once they say yes — follow it on the order.',
          );
          router.push(`/orders/${result.orderId}`);
        }}
      />
    </div>
  );
}
