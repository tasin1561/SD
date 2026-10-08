'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';
import { ArrowLeft, OctagonX, Send } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Select } from '@skydrop/ui/app/select';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { serverVerdict } from '@/lib/server-verdict';
import { useMyOrders } from '@/lib/order-hooks';
import { useRaiseTicket } from '@/lib/ticket-hooks';
import { BackLink, LinkButton, Notice, Section } from '../../../_components/parts';
import '../../../_components/as.css';

/**
 * An issue always hangs off ONE order — that is what makes it findable
 * later and what tells whoever reads it which parcel is being talked
 * about. The order can arrive in the URL (the "Raise an issue" button on
 * an order) or be picked from the most recent ones.
 *
 * NOTHING about money is sent. A store's own ticket form can raise a
 * figure correction — a claim for an amount, payable by the store or by
 * its seller, settled by moving money between their two wallets. An
 * associate has no wallet and no business naming a figure in somebody
 * else's settlement, so this sends the order, a subject and what
 * happened, and nothing else.
 */
export function NewIssueForm(): ReactElement {
  const router = useRouter();
  const params = useSearchParams();
  const [orderId, setOrderId] = useState(params.get('orderId') ?? '');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const raise = useRaiseTicket();

  // Enough to find the order somebody is thinking of without a search.
  const orders = useMyOrders({ page: 1, pageSize: 50 });

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      const ticket = await raise.mutateAsync({
        orderId,
        subject: subject.trim(),
        ...(description.trim() === '' ? {} : { description: description.trim() }),
      });
      router.push(`/tickets/${ticket.id}`);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  const header = (
    <PageHeader
      title="Raise an issue"
      subtitle="Say which order it is about and what has gone wrong. Skydrop and your store read it and reply on the same thread."
    />
  );

  if (orders.isPending) {
    return (
      <div className="as-page">
        {header}
        <SkeletonRows rows={3} cols={1} label="Loading your orders" />
      </div>
    );
  }
  if (orders.isError) {
    return (
      <div className="as-page">
        {header}
        <ErrorState message={serverVerdict(orders.error)} retry={() => void orders.refetch()} />
      </div>
    );
  }
  if (orders.data.items.length === 0) {
    return (
      <div className="as-page">
        {header}
        <EmptyState
          title="Nothing to raise an issue about"
          description="An issue hangs off one of your orders, and you have not placed any yet."
          action={
            <LinkButton href="/orders/new" variant="primary">
              Place an order
            </LinkButton>
          }
        />
      </div>
    );
  }

  return (
    <form className="as-page" onSubmit={(e) => void submit(e)}>
      <BackLink href="/tickets" icon={<ArrowLeft size={14} aria-hidden />}>
        Issues
      </BackLink>
      {header}

      <Section title="The issue">
        <div className="as-stack as-stack--tight">
          <Select
            label="Which order?"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            required
          >
            <option value="">Choose one of your orders</option>
            {orders.data.items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.orderNumber} — {o.recipientName}
              </option>
            ))}
          </Select>
          <TextField
            label="What is it about?"
            hint="One line, so it can be found later — “Parcel arrived damaged”"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={120}
            showCount
            required
          />
          <TextArea
            label="What happened? (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            showCount
          />
          {error !== null ? (
            <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
              <p className="as-error">{error}</p>
            </Notice>
          ) : null}
          <div className="as-row">
            <AsyncButton
              type="submit"
              variant="primary"
              icon={<Send size={15} />}
              labels={{ idle: 'Raise it', busy: 'Sending…', error: 'Not sent' }}
              state={raise.isPending ? 'busy' : error !== null ? 'error' : 'idle'}
              disabled={raise.isPending || orderId === '' || subject.trim() === ''}
            />
          </div>
        </div>
      </Section>
    </form>
  );
}
