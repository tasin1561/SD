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
import { richMessage, useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';
import { verdict } from '@/i18n/verdict';
import { can } from '@/lib/page-access';
import { useStoreIdentity } from '@skydrop/auth/client';
import {
  useStoreCustomer,
  useStoreOrders,
  useUpdateStoreCustomer,
  type StoreCustomer,
} from '@/lib/order-hooks';
import '../_components/customers.css';

/**
 * One of THIS store's customers (RS-5, ORD-7 per owner) and every order the
 * store has placed for them. Their orders are found by their phone number —
 * the one fact about a customer that never changes (ORD-7).
 */
export default function StoreCustomerPage(): ReactElement {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const customer = useStoreCustomer(id);
  const t = useT();

  return (
    <div className="rc-cst-page">
      {customer.isPending ? (
        <>
          <PageHeader
            breadcrumbs={[
              { label: t('cst.d.crumb'), href: '/customers' },
              { label: t('cst.d.customer') },
            ]}
            Link={Link}
            title={t('cst.d.customer')}
          />
          <SkeletonRows rows={4} cols={2} label={t('cst.d.loading')} />
        </>
      ) : customer.isError ? (
        <>
          <PageHeader
            breadcrumbs={[
              { label: t('cst.d.crumb'), href: '/customers' },
              { label: t('cst.d.customer') },
            ]}
            Link={Link}
            title={t('cst.d.customer')}
          />
          <ErrorState message={verdict(customer.error, t)} retry={() => void customer.refetch()} />
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
  const t = useT();
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
      toast.success(t('cst.d.toast'));
      setOpen(false);
    } catch (err) {
      setError(verdict(err, t));
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
        {t('cst.d.edit')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
        size="md"
        icon={<UserRound size={18} />}
        title={t('cst.d.editTitle')}
        description={t('cst.d.editDesc')}
        footer={
          <DialogFooter>
            <Button variant="ghost" size="md" onClick={() => setOpen(false)}>
              {t('cst.d.cancel')}
            </Button>
            <AsyncButton
              variant="primary"
              size="md"
              disabled={update.isPending}
              labels={{
                idle: t('cst.d.save'),
                busy: t('cst.d.saving'),
                done: t('cst.d.saved'),
                error: t('cst.d.notSaved'),
              }}
              onAction={save}
            />
          </DialogFooter>
        }
      >
        <div className="rc-cst-form">
          <TextField
            id="cust-name"
            label={t('cst.d.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            id="cust-email"
            label={t('cst.d.email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            id="cust-alt"
            label={t('cst.d.otherPhone')}
            hint={t('cst.d.otherPhoneHint')}
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
  const t = useT();
  const locale = useLocale();
  const when = (iso: string | null): string => (iso === null ? '—' : formatDateTime(iso, locale));
  const router = useRouter();
  const orders = useStoreOrders({ search: c.phoneE164, pageSize: 50 });
  const allOrdersHref = `/orders?search=${encodeURIComponent(c.phoneE164)}`;

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: t('cst.d.crumb'), href: '/customers' },
          { label: c.name ?? t('cst.noName') },
        ]}
        Link={Link}
        title={c.name ?? t('cst.noName')}
        subtitle={t('cst.d.subtitle')}
        action={<EditCustomer customer={c} />}
      />
      <div className="rc-cst-card">
        <dl className="rc-cst-facts">
          <Fact label={t('cst.d.phone')}>
            <span className="sk-ident">{c.phoneE164}</span>
          </Fact>
          <Fact label={t('cst.d.otherPhone')}>
            {c.altPhoneE164 === null ? '—' : <span className="sk-ident">{c.altPhoneE164}</span>}
          </Fact>
          <Fact label={t('cst.d.email')}>{c.email ?? '—'}</Fact>
          <Fact label={t('cst.d.orders')}>
            <span className="sk-figure">{String(c.totalOrdersCount)}</span>
          </Fact>
          <Fact label={t('cst.d.lastOrder')}>
            <span className="sk-figure">{when(c.lastOrderAt)}</span>
          </Fact>
          <Fact label={t('cst.d.firstSeen')}>
            <span className="sk-figure">{when(c.createdAt)}</span>
          </Fact>
        </dl>
      </div>
      <section className="rc-cst-section">
        <SectionHeading
          title={t('cst.d.theirOrders')}
          note={t('cst.d.newestFirst')}
          action={
            <Link href={allOrdersHref} className="rc-cst-open">
              {t('cst.d.openInOrders')} <ArrowRight size={14} aria-hidden />
            </Link>
          }
        />
        {orders.isPending ? (
          <SkeletonRows rows={3} cols={4} label={t('cst.d.ordersLoading')} />
        ) : orders.isError ? (
          <ErrorState message={verdict(orders.error, t)} retry={() => void orders.refetch()} />
        ) : orders.data.items.length === 0 ? (
          <EmptyState title={t('cst.d.noOrders')} description={t('cst.d.noOrdersBody')} />
        ) : (
          <>
            <Table caption={t('cst.d.theirOrders')}>
              <THead>
                <Tr>
                  <Th>{t('cst.d.col.order')}</Th>
                  <Th>{t('cst.d.col.status')}</Th>
                  <Th align="right">{t('cst.d.col.collect')}</Th>
                  <Th>{t('cst.d.col.placed')}</Th>
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
                        label={statusLabel(o.status, locale)}
                        size="sm"
                      />
                    </Td>
                    <Td align="right">
                      {o.codAmountInr === null ? (
                        <span className="rc-cst-faint">{t('cst.d.prepaid')}</span>
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
                {richMessage(
                  t('cst.d.showing', {
                    shown: orders.data.items.length,
                    total: orders.data.total,
                  }),
                  { link: <Link href={allOrdersHref}>{t('cst.d.seeAll')}</Link> },
                )}
              </p>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
