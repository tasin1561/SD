'use client';

import Link from 'next/link';
import { ArrowLeft, LifeBuoy, Pencil, PhoneCall, Truck, Undo2, XCircle } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import type { OrderStatus } from '@skydrop/db';
import type { OrderView } from '@skydrop/api-client';
import { orderStatusKind, statusLabel } from '@skydrop/ui/status';
import { Button } from '@skydrop/ui/app/button';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TooltipCard } from '@skydrop/ui/app/tooltip-card';
import { useLocale, useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import { LinkButton } from '../orders-parts';
import { CopyButton } from './copy-button';
import { fmtFull, fmtWhen } from './format';

/**
 * What the header may offer. Each entry is `null` when the page's existing
 * condition says "not for this order" — the conditions themselves
 * (`canAsk`, `can(identity, …)`, the status sets) stay in `order-detail.tsx`
 * exactly as they were; this component only lays the buttons out.
 */
export interface HeaderActions {
  readonly askAdmin: (() => void) | null;
  readonly raiseIssue: () => void;
  readonly editHref: string | null;
  /** "Ask us to call again" / "Ask again". */
  readonly reattempt: { readonly label: string; readonly onClick: () => void } | null;
  readonly requestReturn: (() => void) | null;
  readonly cancel: (() => void) | null;
}

/**
 * The order header. Two parts:
 *
 *  1. the STICKY BAR (never taller than 64px at 640px and up): back, the order
 *     number with its copy button, and the status. Opaque, under the console's
 *     own top bar, a shadow only while it is actually stuck is not needed —
 *     the hairline and surface are enough.
 *  2. the FACTS + ACTIONS row beneath it (scrolls away): the payment chip,
 *     who sold it, your reference, the one-line facts, and every action.
 *     Actions wrap onto more lines rather than hide or sit in a menu.
 *
 * At most ONE primary button: "Ask admin to act" if shown, else "Ask us to
 * call"/"Ask again", else none. "Cancel order" is always last, ghost, with a
 * gap before it.
 */
export function OrderHeader({
  order,
  actions,
}: {
  readonly order: OrderView;
  readonly actions: HeaderActions;
}): ReactElement {
  const t = useT();
  const locale = useLocale();
  const words = { today: t('orderPage.today'), yesterday: t('orderPage.yesterday') };
  const when = (iso: string): ReactNode => (
    <time dateTime={iso} title={fmtFull(iso, locale)}>
      {fmtWhen(iso, locale, words)}
    </time>
  );
  const status = order.status as OrderStatus;
  const crumb = `${t('orderDetail.clientConsole')} › ${t('orderDetail.orders')}`;
  const primaryAsk = actions.askAdmin !== null;
  const primaryReattempt = !primaryAsk && actions.reattempt !== null;

  return (
    <header className="cod-head">
      <div className="cod-bar">
        <TooltipCard layer="fixed" title={t('orderPage.back')} description={crumb}>
          <Link
            href="/orders"
            className="cod-iconbtn"
            aria-label={`${t('orderPage.back')}: ${crumb}`}
          >
            <ArrowLeft size={18} aria-hidden />
          </Link>
        </TooltipCard>
        <Link href="/orders" className="cod-crumb">
          {t('orderDetail.orders')} <span aria-hidden>/</span>
        </Link>
        <h1 className="cod-bar__no sk-ident">{order.orderNumber}</h1>
        <CopyButton value={order.orderNumber} />
        <StatusChip
          kind={orderStatusKind(status)}
          label={statusLabel(status, locale)}
          title={statusLabel(status, locale)}
          size="md"
          className="cod-bar__chip"
        />
        <span className="cod-pill cod-bar__pay" data-tone="accent">
          {order.paymentMode === 'COD' ? t('orderDetail.cashOnDelivery') : t('orderDetail.prepaid')}
        </span>
        {order.storeKind === 'RESELLER' && (
          <span className="cod-pill cod-bar__pay">
            {richMessage(t('orderDetail.soldBy'), {
              t: order.storeNameSnapshot ?? t('orderDetail.aMemberStore'),
            })}
          </span>
        )}
      </div>

      <div className="cod-meta">
        {/* One quiet line: your reference and when. "Updated" is gone — it
            was always the same time as "Last moved" (owner, 2026-11-13). The
            amount, contents and weight are in the summary sentence below. */}
        <p className="cod-meta__line">
          {order.sellerOrderRef ? (
            <span className="cod-ref">
              {richMessage(t('orderDetail.yourRef'), {
                span: <span className="sk-ident">{order.sellerOrderRef}</span>,
              })}
            </span>
          ) : null}
          <span>{richMessage(t('orderPage.placedAt'), { when: when(order.placedAt) })}</span>
          <span>{richMessage(t('orderPage.lastMovedAt'), { when: when(order.updatedAt) })}</span>
        </p>

        <div className="cod-actions" role="group" aria-label={t('orderPage.actions')}>
          {/* The two things a seller can DO about a live parcel, beside the
              order number, where a seller looks for something to do. */}
          {actions.askAdmin !== null && (
            <Button
              variant="primary"
              size="md"
              icon={<Truck size={16} />}
              onClick={actions.askAdmin}
            >
              {t('orderDetail.askAdminToAct')}
            </Button>
          )}
          {actions.reattempt !== null && (
            <Button
              variant={primaryReattempt ? 'primary' : 'secondary'}
              size="md"
              icon={<PhoneCall size={16} />}
              onClick={actions.reattempt.onClick}
            >
              {actions.reattempt.label}
            </Button>
          )}
          <Button
            variant="secondary"
            size="md"
            icon={<LifeBuoy size={16} />}
            onClick={actions.raiseIssue}
          >
            {t('orderDetail.raiseAnIssue')}
          </Button>
          {actions.editHref !== null && (
            <LinkButton
              href={actions.editHref}
              variant="secondary"
              size="md"
              icon={<Pencil size={16} />}
            >
              {t('orderPage.editOrder')}
            </LinkButton>
          )}
          {actions.requestReturn !== null && (
            <Button
              variant="secondary"
              size="md"
              icon={<Undo2 size={16} />}
              onClick={actions.requestReturn}
            >
              {t('orderDetail.requestReturn')}
            </Button>
          )}
          {actions.cancel !== null && (
            <Button
              variant="ghost"
              size="md"
              icon={<XCircle size={16} />}
              onClick={actions.cancel}
              className="cod-actions__cancel"
            >
              {t('orderPage.cancelOrder')}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
