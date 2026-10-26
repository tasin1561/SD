'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import { ArrowLeft, ExternalLink, MessagesSquare, OctagonX, Truck } from 'lucide-react';
import { useStoreIdentity } from '@skydrop/auth/client';
import { Money, ProductThumb } from '@skydrop/ui/components';
import { orderStatusKind, statusLabel } from '@skydrop/ui/status';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { TextArea } from '@skydrop/ui/app/text-field';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { can } from '@/lib/page-access';
import { richMessage, useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';
import { verdict } from '@/i18n/verdict';
import { useCancelOrder, useMyOrder, useMyOrderEvents } from '@/lib/order-hooks';
import { BackLink, Facts, LinkButton, Notice, Section } from '../../_components/parts';
import { Reattempt } from './_components/reattempt';
import '../../_components/as.css';

/** Where a customer looks their own parcel up. */
const TRACK_URL = process.env.NEXT_PUBLIC_TRACK_URL ?? 'https://track.skydrop.global';

/**
 * One of this person's own orders.
 *
 * ── WHAT IS NOT HERE ────────────────────────────────────────────────
 * No transfer price per line, no transfer total, and no call to
 * `GET /store/orders/:id/money` — the first two are what the STORE pays
 * the seller and the third is what the order earns the store. Both are
 * the store's spread on this person. The types in `@/lib/order-hooks` do
 * not declare them, so there is nothing on this page to accidentally
 * render, and a sweep over this app's sources (`no-store-cost.test.ts`)
 * fails if a name comes back.
 *
 * CANCELLING and ASKING FOR ANOTHER DELIVERY ATTEMPT are both here,
 * because the owner named both: "yes can cancel and asl for a
 * reattempt". A sales person whose customer changes their mind, or who
 * says "I was out, try tomorrow", is the person who should do it. In
 * each case the REPLY decides what happened — done now, or held for the
 * people who run the store, who may have to approve it first. Never a
 * policy read when the page loaded, because it may have changed since
 * and "a van is coming" told wrongly reaches a customer.
 *
 * Send-back and recall are NOT here: the owner named two things, and a
 * send-back turns a parcel round at somebody's cost on one click.
 */
export default function OrderDetailPage(): ReactElement {
  const t = useT();
  const locale = useLocale();
  const when = (iso: string): string => formatDateTime(iso, locale);
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const me = useStoreIdentity();
  const toast = useToast();
  const order = useMyOrder(id);
  const events = useMyOrderEvents(id);
  const cancel = useCancelOrder();
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Set when a cancel was HELD rather than applied — the reply said so. */
  const [held, setHeld] = useState<string | null>(null);

  if (order.isPending) {
    return (
      <div className="as-page">
        <PageHeader title={t('order.title')} />
        <SkeletonRows rows={5} cols={2} label={t('order.loading')} />
      </div>
    );
  }
  if (order.isError) {
    return (
      <div className="as-page">
        <PageHeader title={t('order.title')} />
        <ErrorState message={verdict(order.error, t)} retry={() => void order.refetch()} />
      </div>
    );
  }

  const o = order.data;
  const mayCancel = can(me, 'orders.cancel') && o.stages.cancel;
  const live = o.shipments.filter((s) => s.awbNumber !== null);

  async function doCancel(): Promise<void> {
    setError(null);
    try {
      const outcome = await cancel.mutateAsync({
        id,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      if (outcome.applied) {
        setHeld(null);
        toast.success(t('order.cancelled'));
      } else {
        setHeld(outcome.request.label);
      }
      setNote('');
    } catch (err) {
      setError(verdict(err, t));
      throw err;
    }
  }

  return (
    <div className="as-page">
      <BackLink href="/orders" icon={<ArrowLeft size={14} aria-hidden />}>
        {t('nav.myOrders')}
      </BackLink>
      <PageHeader
        title={o.orderNumber}
        subtitle={t('order.placed', { when: when(o.placedAt) })}
        action={
          <div className="as-row">
            <LinkButton
              href={`/tickets/new?orderId=${o.id}`}
              variant="ghost"
              icon={<MessagesSquare size={15} />}
            >
              {t('order.raiseIssue')}
            </LinkButton>
            {mayCancel ? (
              <Button
                variant="destructive"
                size="md"
                icon={<OctagonX size={15} />}
                onClick={() => setConfirming(true)}
              >
                {t('order.cancel')}
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="as-row">
        <StatusChip kind={orderStatusKind(o.status)} label={statusLabel(o.status, locale)} />
        {o.sellerOrderRef !== null && o.sellerOrderRef !== '' ? (
          <span className="as-muted">
            {richMessage(t('order.yourRef'), {
              ref: <span className="sk-ident">{o.sellerOrderRef}</span>,
            })}
          </span>
        ) : null}
      </div>

      {held !== null ? (
        <Notice tone="warn" title={t('order.held.title')} role="status">
          <span>{t('order.held.body', { held })}</span>
        </Notice>
      ) : null}

      <div className="as-split">
        <Section title={t('order.inside')}>
          <ul className="as-items">
            {o.lines.map((l) => (
              <li key={l.id} className="as-item">
                <ProductThumb src={l.imageUrl} size={44} alt="" />
                <div className="as-item__body">
                  <span className="as-strong">
                    {l.variantLabel === null
                      ? l.productName
                      : `${l.productName} · ${l.variantLabel}`}
                  </span>
                  <span className="as-sub">
                    <span className="sk-ident">{l.skuCode}</span> · {l.quantity} ×{' '}
                    {l.retailUnitInr === null ? (
                      '—'
                    ) : (
                      <Money amount={l.retailUnitInr} convert={false} />
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <p className="as-total">
            <span>{t('order.soldFor')}</span>
            <Money amount={o.totals.retailInr} convert={false} />
          </p>
        </Section>

        <Section title={t('order.goingTo')}>
          <Facts
            items={[
              { label: t('order.name'), value: o.recipient.name },
              {
                label: t('order.phone'),
                value: <span className="sk-ident">{o.recipient.phoneE164}</span>,
              },
              { label: t('order.email'), value: o.recipient.email ?? '—' },
              {
                label: t('order.address'),
                value: [o.recipient.addressLine1, o.recipient.addressLine2]
                  .filter((v) => v !== null && v !== '')
                  .join(', '),
              },
              {
                label: t('order.pin'),
                value: <span className="sk-ident">{o.recipient.postalCode}</span>,
              },
            ]}
          />
        </Section>
      </div>

      <div className="as-split">
        <Section title={t('order.paidFor')}>
          <Facts
            items={[
              {
                label: t('order.payment'),
                value: o.paymentMode === 'COD' ? t('order.cod') : t('order.prepaid'),
              },
              {
                label: t('order.toCollect'),
                value:
                  o.codAmountInr === null ? (
                    t('order.alreadyPaid')
                  ) : (
                    <Money amount={o.codAmountInr} convert={false} />
                  ),
              },
              {
                label: t('order.deliveryCharge'),
                value:
                  o.deliveryFeeInr === null ? (
                    '—'
                  ) : (
                    <Money amount={o.deliveryFeeInr} convert={false} />
                  ),
              },
              { label: t('order.notes'), value: o.notes ?? '—' },
            ]}
          />
        </Section>

        <Section title={t('order.parcel')}>
          {live.length === 0 ? (
            <p className="as-p">{t('order.noWaybill')}</p>
          ) : (
            <Facts
              items={live.map((s) => ({
                label: s.courierCode,
                value: (
                  <span className="as-row">
                    <span className="sk-ident">{s.awbNumber}</span>
                    <Link
                      href={`${TRACK_URL}/${s.awbNumber ?? ''}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="as-link"
                    >
                      <Truck size={13} aria-hidden /> {t('order.trackIt')}{' '}
                      <ExternalLink size={11} aria-hidden />
                    </Link>
                  </span>
                ),
              }))}
            />
          )}
        </Section>
      </div>

      {/* ASSOC-1 — "can cancel and ask for a reattempt" (the owner).
          Renders nothing at all when the store has not enabled it and
          nothing has ever been asked for on this parcel. */}
      <Reattempt orderId={o.id} orderNumber={o.orderNumber} stageOpen={o.stages.deliveryActions} />

      <Section title={t('order.history')} bare>
        <div className="as-card">
          {events.isPending ? (
            <SkeletonRows rows={3} cols={1} label={t('order.historyLoading')} />
          ) : events.isError ? (
            <ErrorState message={verdict(events.error, t)} retry={() => void events.refetch()} />
          ) : events.data.length === 0 ? (
            <p className="as-p">{t('order.noEvents')}</p>
          ) : (
            <ol className="as-events">
              {[...events.data]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map((e) => (
                  <li key={e.id} className="as-event">
                    <span className="as-event__when sk-figure">{when(e.createdAt)}</span>
                    <p className="as-event__what">
                      {e.description !== null && e.description !== ''
                        ? e.description
                        : e.toStatus !== null
                          ? statusLabel(e.toStatus, locale)
                          : e.type}
                    </p>
                  </li>
                ))}
            </ol>
          )}
        </div>
      </Section>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('order.cancelDialog.title')}
        entity={o.orderNumber}
        entityIsIdentifier
        consequence={t('order.cancelDialog.consequence')}
        confirmLabel={t('order.cancelDialog.confirm')}
        cancelLabel={t('order.cancelDialog.keep')}
        destructive
        error={error}
        onConfirm={doCancel}
      >
        <TextArea
          label={t('order.cancelDialog.why')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          showCount
        />
      </ConfirmDialog>
    </div>
  );
}
