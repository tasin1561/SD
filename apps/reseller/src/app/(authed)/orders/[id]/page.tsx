'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useStoreIdentity } from '@skydrop/auth/client';
import {
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  ErrorState,
  LoadingState,
  Money,
  OrderStatusBadge,
  PageHeader,
  ProductThumb,
  Section,
  TBody,
  THead,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { statusLabel } from '@skydrop/ui/status';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useCancelStoreOrder,
  useStoreOrder,
  useStoreOrderEvents,
  type StoreOrderView,
} from '@/lib/order-hooks';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * RS-5 — one of this store's orders: who it is going to, what is in it,
 * what the store sold it for and what it pays the seller, the waybill
 * once there is one, and the timeline. Cancelling is offered until the
 * order is finished; the server decides whether it is still possible
 * (until it is packed) and says so in its own words (FE-2).
 */
export default function StoreOrderPage(): ReactElement {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const order = useStoreOrder(id);

  return (
    <div className="space-y-6">
      <Link
        href="/orders"
        className="text-text-muted hover:text-text-body inline-flex items-center gap-1.5 text-xs"
      >
        <ArrowLeft size={12} /> Orders
      </Link>
      {order.isPending ? (
        <LoadingState label="Loading the order" rows={6} />
      ) : order.isError ? (
        <ErrorState message={serverVerdict(order.error)} retry={() => void order.refetch()} />
      ) : (
        <OrderBody order={order.data} />
      )}
    </div>
  );
}

function OrderBody({ order: o }: { order: StoreOrderView }): ReactElement {
  const me = useStoreIdentity();
  const toast = useToast();
  const cancel = useCancelStoreOrder();
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function doCancel(): Promise<void> {
    setError(null);
    try {
      await cancel.mutateAsync({ id: o.id, note: note.trim() });
      toast.success('Order cancelled.');
      setConfirming(false);
    } catch (err) {
      setError(serverVerdict(err));
      setConfirming(false);
    }
  }

  return (
    <>
      <PageHeader
        title={<span className="font-mono">{o.orderNumber}</span>}
        subtitle={
          o.sellerOrderRef === null ? (
            `Placed ${when(o.placedAt)}`
          ) : (
            <span>
              Your reference <span className="font-mono">{o.sellerOrderRef}</span> · placed{' '}
              {when(o.placedAt)}
            </span>
          )
        }
        action={
          <div className="flex items-center gap-2">
            <OrderStatusBadge status={o.status} />
            {!o.terminal && can(me, 'orders.cancel') ? (
              <Button variant="ghost" size="md" onClick={() => setConfirming(true)}>
                Cancel order
              </Button>
            ) : null}
          </div>
        }
      />
      {error !== null ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Customer">
          <Card>
            <CardBody>
              <dl className="grid grid-cols-[minmax(84px,36%)_1fr] gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[140px_1fr]">
                <dt className="text-text-muted">Name</dt>
                <dd>{o.recipient.name}</dd>
                <dt className="text-text-muted">Phone</dt>
                <dd className="font-mono text-xs">
                  {o.recipient.phoneE164}
                  {o.recipient.altPhoneE164 !== null ? ` / ${o.recipient.altPhoneE164}` : ''}
                </dd>
                {o.recipient.email !== null ? (
                  <>
                    <dt className="text-text-muted">Email</dt>
                    <dd className="font-mono text-xs">{o.recipient.email}</dd>
                  </>
                ) : null}
                <dt className="text-text-muted">Address</dt>
                <dd>
                  <div>{o.recipient.addressLine1}</div>
                  {o.recipient.addressLine2 !== null ? <div>{o.recipient.addressLine2}</div> : null}
                  <div className="mt-0.5">
                    {[o.recipient.city, o.recipient.stateProvince].filter(Boolean).join(', ')}{' '}
                    <span className="font-mono">{o.recipient.postalCode}</span>
                  </div>
                </dd>
              </dl>
            </CardBody>
          </Card>
        </Section>

        <Section title="Money">
          <Card>
            <CardBody>
              <dl className="grid grid-cols-[minmax(84px,40%)_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-text-muted">Payment</dt>
                <dd>{o.paymentMode === 'COD' ? 'Cash on delivery' : 'Prepaid'}</dd>
                <dt className="text-text-muted">To collect</dt>
                <dd>
                  {o.codAmountInr === null ? (
                    '—'
                  ) : (
                    <Money amount={o.codAmountInr} convert={false} />
                  )}
                </dd>
                <dt className="text-text-muted">You sold it for</dt>
                <dd>
                  <Money amount={o.totals.retailInr} convert={false} />
                </dd>
                <dt className="text-text-muted">You pay the seller</dt>
                <dd>
                  <Money amount={o.totals.transferInr} convert={false} />
                </dd>
                <dt className="text-text-muted">Terms</dt>
                <dd>{o.termsVersion === null ? '—' : `Version ${o.termsVersion}`}</dd>
              </dl>
              <p className="text-text-faint mt-3 text-xs">
                Prices and terms are fixed as they were when the order was placed.
              </p>
            </CardBody>
          </Card>
        </Section>
      </div>

      <Section title="Products">
        <Table>
          <THead>
            <Tr>
              <Th>Product</Th>
              <Th align="right">Qty</Th>
              <Th align="right">Sold at</Th>
              <Th align="right">You pay</Th>
            </Tr>
          </THead>
          <TBody>
            {o.lines.map((l) => (
              <Tr key={l.id}>
                <Td>
                  <div className="flex items-start gap-3">
                    <ProductThumb src={l.imageUrl} size={40} alt={l.productName} />
                    <div>
                      <div>{l.productName}</div>
                      <div className="text-text-faint font-mono text-xs">
                        {l.skuCode}
                        {l.variantLabel !== null ? ` · ${l.variantLabel}` : ''}
                      </div>
                    </div>
                  </div>
                </Td>
                <Td align="right">{l.quantity}</Td>
                <Td align="right">
                  {l.retailUnitInr === null ? (
                    '—'
                  ) : (
                    <Money amount={l.retailUnitInr} convert={false} />
                  )}
                </Td>
                <Td align="right">
                  {l.transferPriceInr === null ? (
                    '—'
                  ) : (
                    <Money amount={l.transferPriceInr} convert={false} />
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Section>

      {o.shipments.some((s) => s.awbNumber !== null) ? (
        <Section title="Parcel">
          <Card>
            <CardBody>
              {o.shipments
                .filter((s) => s.awbNumber !== null)
                .map((s) => (
                  <div key={s.awbNumber ?? s.courierCode} className="text-sm">
                    Waybill <span className="font-mono">{s.awbNumber}</span> · {s.courierCode} ·{' '}
                    {s.status.toLowerCase().replace(/_/g, ' ')}
                  </div>
                ))}
            </CardBody>
          </Card>
        </Section>
      ) : null}

      <Timeline orderId={o.id} />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Cancel ${o.orderNumber}?`}
        description={
          <div className="space-y-2">
            <p>
              An order can be cancelled until it is packed. The customer is not told by us — let
              them know yourself.
            </p>
            <Textarea
              aria-label="Why (optional)"
              placeholder="Why (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
          </div>
        }
        confirmLabel="Cancel the order"
        confirmVariant="destructive"
        disabled={cancel.isPending}
        onConfirm={() => void doCancel()}
      />
    </>
  );
}

function Timeline({ orderId }: { orderId: string }): ReactElement {
  const events = useStoreOrderEvents(orderId);
  return (
    <Section title="Timeline">
      {events.isPending ? (
        <LoadingState label="Loading the timeline" rows={3} />
      ) : events.isError ? (
        <ErrorState message={serverVerdict(events.error)} retry={() => void events.refetch()} />
      ) : events.data.length === 0 ? (
        <p className="text-text-muted text-sm">Nothing has happened to this order yet.</p>
      ) : (
        <ol className="space-y-2">
          {events.data.map((e) => (
            <li key={e.id} className="text-sm">
              <span className="text-text-muted text-xs">{when(e.createdAt)}</span>{' '}
              <span className="text-text-body">
                {e.toStatus !== null ? statusLabel(e.toStatus) : (e.description ?? e.type)}
              </span>
              {e.toStatus !== null && e.description !== null ? (
                <span className="text-text-faint"> — {e.description}</span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
