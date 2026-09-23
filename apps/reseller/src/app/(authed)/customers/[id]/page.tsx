'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type ReactElement, type ReactNode } from 'react';
import { ArrowRight, Pencil, UserRound } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { orderStatusKind, statusLabel } from '@skydrop/ui/status';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextField } from '@skydrop/ui/app/text-field';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { serverVerdict } from '@/lib/server-verdict';
import { can } from '@/lib/page-access';
import { useStoreIdentity } from '@skydrop/auth/client';
import {
  useStoreCustomer,
  useStoreOrders,
  useUpdateStoreCustomer,
  type StoreCustomer,
} from '@/lib/order-hooks';
import '../_components/customers.css';

function when(iso: string | null): string {
  return iso === null
    ? '—'
    : new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * One of THIS store's customers (RS-5, ORD-7 per owner) and every order the
 * store has placed for them. Their orders are found by their phone number —
 * the one fact about a customer that never changes (ORD-7).
 */
export default function StoreCustomerPage(): ReactElement {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const customer = useStoreCustomer(id);

  return (
    <div className="rc-cst-page">
      {customer.isPending ? (
        <>
          <PageHeader
            breadcrumbs={[{ label: 'Customers', href: '/customers' }, { label: 'Customer' }]}
            Link={Link}
            title="Customer"
          />
          <SkeletonRows rows={4} cols={2} label="Loading the customer" />
        </>
      ) : customer.isError ? (
        <>
          <PageHeader
            breadcrumbs={[{ label: 'Customers', href: '/customers' }, { label: 'Customer' }]}
            Link={Link}
            title="Customer"
          />
          <ErrorState
            message={serverVerdict(customer.error)}
            retry={() => void customer.refetch()}
          />
        </>
      ) : (
        <CustomerBody customer={customer.data} />
      )}
    </div>
  );
}

/**
 * Correcting what we hold for one of this store's customers (owner,
 * 2026-09-18).
 *
 * The PHONE is not here and never will be: it is what tells one customer
 * from another (ORD-7), and a changed one is a different person. Seller
 * staff may make the same correction, and whichever side does it the
 * other is told.
 */
function EditCustomer({ customer: c }: { customer: StoreCustomer }): ReactElement {
  const me = useStoreIdentity();
  const update = useUpdateStoreCustomer();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(c.name ?? '');
  const [email, setEmail] = useState(c.email ?? '');
  const [alt, setAlt] = useState(c.altPhoneE164 ?? '');
  const [error, setError] = useState<string | null>(null);

  // Cosmetic only — the server refuses without the permission either way
  // (FE-2). Hiding a button whose save comes back 403 is the point.
  if (me === null || !can(me, 'customers.manage')) return <></>;

  /**
   * The real request. It rejects after showing the server's verdict, so
   * the save button shows the failure it really had.
   */
  const save = async (): Promise<void> => {
    setError(null);
    try {
      await update.mutateAsync({
        id: c.id,
        name: name.trim(),
        email: email.trim() === '' ? null : email.trim(),
        altPhoneE164: alt.trim() === '' ? null : alt.trim(),
      });
      toast.success('Saved. Your seller has been told what changed.');
      setOpen(false);
    } catch (err) {
      setError(serverVerdict(err));
      throw err;
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        icon={<Pencil size={14} />}
        onClick={() => setOpen(true)}
      >
        Edit details
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
        size="md"
        icon={<UserRound size={18} />}
        title="Edit this customer"
        description="Their phone number is how we tell one customer from another, so it never changes. Your seller is told what you changed."
        footer={
          <DialogFooter>
            <Button variant="ghost" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <AsyncButton
              variant="primary"
              size="md"
              disabled={update.isPending}
              labels={{ idle: 'Save', busy: 'Saving…', done: 'Saved', error: 'Not saved' }}
              onAction={save}
            />
          </DialogFooter>
        }
      >
        <div className="rc-cst-form">
          <TextField
            id="cust-name"
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            id="cust-email"
            label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            id="cust-alt"
            label="Other phone"
            hint="A second number to try. With the country code, e.g. +919876543210."
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
          />
          {error !== null ? (
            <p className="rc-cst-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="rc-cst-facts__item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function CustomerBody({ customer: c }: { customer: StoreCustomer }): ReactElement {
  const router = useRouter();
  const orders = useStoreOrders({ search: c.phoneE164, pageSize: 50 });
  const allOrdersHref = `/orders?search=${encodeURIComponent(c.phoneE164)}`;

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Customers', href: '/customers' },
          { label: c.name ?? 'No name given' },
        ]}
        Link={Link}
        title={c.name ?? 'No name given'}
        subtitle="Your customer. Your seller sees them too, and each of you is told when the other changes their details."
        action={<EditCustomer customer={c} />}
      />
      <div className="rc-cst-card">
        <dl className="rc-cst-facts">
          <Fact label="Phone">
            <span className="sk-ident">{c.phoneE164}</span>
          </Fact>
          <Fact label="Other phone">
            {c.altPhoneE164 === null ? '—' : <span className="sk-ident">{c.altPhoneE164}</span>}
          </Fact>
          <Fact label="Email">{c.email ?? '—'}</Fact>
          <Fact label="Orders">
            <span className="sk-figure">{String(c.totalOrdersCount)}</span>
          </Fact>
          <Fact label="Last order">
            <span className="sk-figure">{when(c.lastOrderAt)}</span>
          </Fact>
          <Fact label="First seen">
            <span className="sk-figure">{when(c.createdAt)}</span>
          </Fact>
        </dl>
      </div>
      <section className="rc-cst-section">
        <SectionHeading
          title="Their orders"
          note="Newest first."
          action={
            <Link href={allOrdersHref} className="rc-cst-open">
              Open in orders <ArrowRight size={14} aria-hidden />
            </Link>
          }
        />
        {orders.isPending ? (
          <SkeletonRows rows={3} cols={4} label="Loading their orders" />
        ) : orders.isError ? (
          <ErrorState message={serverVerdict(orders.error)} retry={() => void orders.refetch()} />
        ) : orders.data.items.length === 0 ? (
          <EmptyState
            title="No orders found"
            description="Orders placed for this number appear here."
          />
        ) : (
          <>
            <Table caption="Their orders">
              <THead>
                <Tr>
                  <Th>Order</Th>
                  <Th>Status</Th>
                  <Th align="right">To collect</Th>
                  <Th>Placed</Th>
                </Tr>
              </THead>
              <TBody>
                {orders.data.items.map((o) => (
                  <Tr key={o.id} onActivate={() => router.push(`/orders/${o.id}`)}>
                    <Td>
                      <Link href={`/orders/${o.id}`} className="rc-cst-link sk-ident">
                        {o.orderNumber}
                      </Link>
                    </Td>
                    <Td>
                      <StatusChip
                        kind={orderStatusKind(o.status)}
                        label={statusLabel(o.status)}
                        size="sm"
                      />
                    </Td>
                    <Td align="right">
                      {o.codAmountInr === null ? (
                        <span className="rc-cst-faint">Prepaid</span>
                      ) : (
                        <Money amount={o.codAmountInr} convert={false} />
                      )}
                    </Td>
                    <Td>
                      <span className="rc-cst-muted sk-figure">{when(o.placedAt)}</span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            {orders.data.total > orders.data.items.length ? (
              <p className="rc-cst-more">
                Showing the latest {orders.data.items.length} of {orders.data.total}.{' '}
                <Link href={allOrdersHref}>See them all</Link>
              </p>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
