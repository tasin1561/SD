'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import { ArrowRight, Boxes, PhoneOff, PhoneMissed } from 'lucide-react';
import { ApiError } from '@skydrop/api-client';
import { OrderStatus } from '@skydrop/db';
import { useStoreIdentity } from '@skydrop/auth/client';
import { Ident, Num } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import { useStoreCallReviews, type StoreCallReview } from '@/lib/review-hooks';
import { useStoreActionPolicy, useStoreOrders, type StoreOrderListItem } from '@/lib/order-hooks';
import { CallReviewDecision } from '@/components/call-review-decision';
import { LinkButton, Notice, RoSection } from '../_components/orders-parts';

const CONTEXT_PAGE_SIZE = 100;

/** How long this has been sitting here. Read from the REVIEW's own
 *  `createdAt` — when the question was raised — never from a row
 *  timestamp that anything else can touch. */
function waitedFor(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return '—';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'less than an hour';
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${Math.floor(hours / 24)} days`;
}

/**
 * ORDERS WE COULD NOT CONFIRM — the queue.
 *
 * Each row is an order where the call centre reached the seller's limit
 * on attempts without ever speaking to the customer, and the seller's
 * stock is STILL HELD against it. Nothing moves until somebody answers:
 * the customer hears nothing, the stock is unavailable to this store's
 * other orders, and the seller is paying for a shelf either way. That is
 * why the page leads with the units held rather than the row count —
 * doing nothing here has a running cost, and a bare list does not say so.
 *
 * Whether this store may answer at all is the seller's policy, decided
 * by the server. When it is theirs, the list refuses and says so in its
 * own words (FE-2) — a sentence naming who answers instead.
 */
export default function CallReviewsPage(): ReactElement {
  const me = useStoreIdentity();
  const mayAnswer = can(me, 'orders.actions');
  const mayReadOrders = can(me, 'orders.view');

  const policy = useStoreActionPolicy({ enabled: mayReadOrders });
  // Switched OFF by the seller: there is nothing to list, so do not ask
  // for a list the server can only refuse.
  const answeredBySeller = policy.data?.callCapDecision === 'OFF';
  const reviews = useStoreCallReviews({ enabled: mayAnswer && !answeredBySeller });
  // The review carries an order ID and nothing else a person can read.
  // One list request supplies the numbers and the customers for every
  // row (these orders are all parked in the same status), rather than a
  // detail fetch per row. A row it cannot name still decides fine.
  const context = useStoreOrders({
    status: OrderStatus.AWAITING_SELLER_DECISION,
    page: 1,
    pageSize: CONTEXT_PAGE_SIZE,
  });
  const orders = new Map<string, StoreOrderListItem>(
    mayReadOrders ? (context.data?.items ?? []).map((o) => [o.id, o]) : [],
  );

  const rows = reviews.data ?? [];
  const heldUnits = rows.reduce((sum, r) => sum + r.heldQty, 0);

  return (
    <div className="ro-page">
      <PageHeader
        title="Customers we could not reach"
        subtitle="Orders where we rang the customer as often as your seller allows and never got through. Until you answer, the stock stays held and nothing is sent."
        action={
          <LinkButton href="/orders" variant="ghost" icon={<ArrowRight size={15} />}>
            All orders
          </LinkButton>
        }
      />

      <div className="ro-kpis">
        <KpiCard
          label="Units held waiting on you"
          icon={<Boxes size={14} />}
          tone={heldUnits > 0 ? 'pending' : 'credit'}
          figure={reviews.isPending ? '—' : <Num value={heldUnits} />}
          hint="Your seller cannot sell these to anyone else meanwhile"
        />
        <KpiCard
          label="Orders waiting on an answer"
          icon={<PhoneMissed size={14} />}
          tone="neutral"
          figure={reviews.isPending ? '—' : <Num value={rows.length} />}
          hint="Each has a customer who has not heard from you"
        />
      </div>

      <RoSection title="Waiting on you" bare>
        {answeredBySeller || isAnsweredBySeller(reviews.error) ? (
          // NOT an error (2026-09-17): the seller keeps these questions for
          // themselves. A red box read as something broken. The server's
          // own sentence is used when it gave one — it names who answers.
          <Notice tone="info" icon={<PhoneOff size={16} />}>
            <span>
              {reviews.error instanceof ApiError
                ? serverVerdictMessage(reviews.error)
                : 'The seller answers call-attempt questions for this store. Ask them whether to keep trying.'}
            </span>
          </Notice>
        ) : reviews.isPending ? (
          <SkeletonRows rows={4} cols={6} label="Loading the orders we could not confirm" />
        ) : reviews.isError ? (
          // Verbatim (FE-2). The common one here is not a fault:
          // STORE_ACTION_NOT_ALLOWED says the seller answers these, and
          // says it in a sentence that tells the reader what to do.
          <ErrorState message={serverVerdict(reviews.error)} retry={() => void reviews.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            tone="positive"
            title="Nothing waiting"
            description="When we run out of call attempts on one of your orders without reaching the customer, it appears here for you to decide: keep trying, or give the stock back."
            action={
              <LinkButton href="/orders" variant="secondary">
                Go to your orders
              </LinkButton>
            }
          />
        ) : (
          <div className="ro-card" data-flush="1">
            <Table caption="Orders waiting on your answer">
              <THead>
                <Tr>
                  <Th>Order</Th>
                  <Th>Customer</Th>
                  <Th align="right">Units held</Th>
                  <Th align="right">Calls made</Th>
                  <Th>Waiting</Th>
                  <Th align="right">Your answer</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <ReviewRow
                    key={r.id}
                    review={r}
                    order={orders.get(r.orderId)}
                    mode={policy.data?.callCapDecision}
                  />
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </RoSection>
    </div>
  );
}

/** The seller keeps call-attempt questions for themselves — a policy, not a fault. */
function isAnsweredBySeller(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'STORE_ACTION_NOT_ALLOWED';
}

/** The server's sentence without the `[CODE]` prefix, for a plain explanation. */
function serverVerdictMessage(err: ApiError): string {
  const body = err.body;
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const m = (body as { message: unknown }).message;
    if (typeof m === 'string' && m !== '') return m;
  }
  return 'The seller answers call-attempt questions for this store. Ask them whether to keep trying.';
}

function ReviewRow({
  review,
  order,
  mode,
}: {
  readonly review: StoreCallReview;
  readonly order: StoreOrderListItem | undefined;
  /** The seller's callCapDecision policy; ASK_SELLER sends the answer to Seller staff. */
  readonly mode: 'OFF' | 'ASK_SELLER' | 'DIRECT' | undefined;
}): ReactElement {
  return (
    <Tr>
      <Td>
        <Link href={`/orders/${review.orderId}`} className="ro-order-link">
          {order === undefined ? (
            // The order is not in the parked list — it has moved on, or
            // there are more than a page of them. The id still opens it.
            <Ident value={`${review.orderId.slice(0, 8)}…`} />
          ) : (
            <span className="sk-ident">{order.orderNumber}</span>
          )}
        </Link>
      </Td>
      <Td>
        {order === undefined ? (
          <span className="ro-faint">Open the order</span>
        ) : (
          <>
            <div>{order.recipientName}</div>
            <span className="ro-sub">
              {[order.recipientPhoneE164, order.recipientCity].filter((v) => v !== '').join(' · ')}
            </span>
          </>
        )}
      </Td>
      <Td align="right">
        <Num value={review.heldQty} />
      </Td>
      <Td align="right">
        <Num value={review.attemptCount} />
      </Td>
      <Td>
        <span className="ro-muted">{waitedFor(review.createdAt)}</span>
      </Td>
      <Td align="right">
        <CallReviewDecision
          review={review}
          orderNumber={order?.orderNumber}
          triggerVariant="primary"
          triggerLabel={mode === 'ASK_SELLER' ? 'Propose an answer' : 'Answer'}
          mode={mode}
        />
      </Td>
    </Tr>
  );
}
