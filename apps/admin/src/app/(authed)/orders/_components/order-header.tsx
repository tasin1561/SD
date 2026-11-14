'use client';

import Link from 'next/link';
import { ArrowLeft, ExternalLink, Info, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { OrderView } from '@skydrop/api-client';
import { MenuButton, Money, type MenuEntry } from '@skydrop/ui/components';
import { orderStatusKind, statusLabel } from '@skydrop/ui/status';
import { Button } from '@skydrop/ui/app/button';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TooltipCard } from '@skydrop/ui/app/tooltip-card';
import { useLocale, useT } from '@/i18n/client';
import { CopyButton } from './copy-button';
import { fmtDay, fmtStamp } from './order-detail-format';
import { TRACK_URL } from './order-shipments-section';

export interface HeaderPrimary {
  readonly label: string;
  readonly icon: ReactNode;
  readonly onClick: () => void;
}

/**
 * The order's one-row header. Sticky under the console's top bar, opaque,
 * a hairline underneath, and a soft shadow ONLY while it is actually stuck
 * (a sentinel above it leaves the viewport; the shadow is a plain state,
 * not an animation). Carries what a person looks the order up by — number,
 * status, the client's ref, every AWB — plus the facts that decide the
 * next move, and the two places actions live: an optional primary button
 * and More.
 *
 * Below 640px it is two compact lines (number/status/More, then AWB and
 * facts scrolling sideways). The order number, the status, the AWB and
 * More never hide; the placed/updated stamps go to a tooltip first, then
 * the client ref.
 */
export function OrderHeader({
  order,
  awbs,
  eta,
  primary,
  entries,
}: {
  readonly order: OrderView;
  readonly awbs: readonly string[];
  /** Expected delivery (ISO) — the courier's estimate, else the order's. */
  readonly eta: string | null;
  readonly primary: HeaderPrimary | null;
  readonly entries: readonly MenuEntry[];
}): ReactElement {
  const t = useT();
  const locale = useLocale();
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const el = sentinel.current;
    if (el === null || typeof IntersectionObserver === 'undefined') return undefined;
    // The sentinel sits just above the header; once it has scrolled out
    // from under the console's top bar the header is stuck.
    const io = new IntersectionObserver(
      ([entry]) => setStuck(entry !== undefined && !entry.isIntersecting),
      { threshold: 0, rootMargin: '-57px 0px 0px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const placed = t('orderDetail.header.placed', { date: fmtDay(order.placedAt) });
  const updated = t('orderDetail.header.updated', { date: fmtDay(order.updatedAt) });
  const money = order.paymentMode === 'COD' ? order.codAmountInr : order.declaredValueInr;

  return (
    <>
      <div ref={sentinel} className="od-sentinel" aria-hidden />
      <header className="od-header" data-stuck={stuck ? '1' : undefined}>
        <div className="od-header__line">
          <TooltipCard
            layer="fixed"
            title={t('orderDetail.header.back')}
            description={`${t('orderDetail.crumb.operations')} › ${t('orderDetail.crumb.orders')}`}
          >
            <Link href="/orders" className="od-iconbtn" aria-label={t('orderDetail.header.back')}>
              <ArrowLeft size={16} aria-hidden />
            </Link>
          </TooltipCard>
          {/* Owner, 2026-11-14: the AWB leads (it is the number a courier, a
              customer and the warehouse quote), labelled "AWB"; with none
              booked yet the slot still reads "AWB ____" so it is plain one
              is coming. The order number moved to the line below. */}
          {awbs.length === 0 ? (
            <span className="od-header__no od-header__no--empty sk-ident">
              {t('orderDetail.header.awbLabel')} ___________________
            </span>
          ) : (
            awbs.map((awb) => (
              <span key={awb} className="od-header__lead">
                <span className="od-header__no sk-ident">
                  {t('orderDetail.header.awbLabel')} {awb}
                </span>
                <CopyButton value={awb} />
                <a
                  href={`${TRACK_URL}/${encodeURIComponent(awb)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="od-iconbtn od-iconbtn--sm"
                  aria-label={`${t('ordersOrderShipmentsSection.publicTracking')}: ${awb}`}
                  title={t('ordersOrderShipmentsSection.publicTracking')}
                >
                  <ExternalLink size={13} aria-hidden />
                </a>
              </span>
            ))
          )}
          {order.hasAdminOverride && (
            <span className="oc-override" title={t('orderDetail.override.title')}>
              <ShieldAlert size={12} aria-hidden />
              {t('orderDetail.override.chip')}
            </span>
          )}
          <StatusChip
            kind={orderStatusKind(order.status)}
            label={statusLabel(order.status, locale)}
            // The full status on hover: on a narrow phone the chip is the
            // one thing in line 1 allowed to ellipsise.
            title={statusLabel(order.status, locale)}
            size="sm"
          />
          {order.sellerOrderRef ? (
            <span className="od-header__ref" title={order.sellerOrderRef}>
              {t('orderDetail.clientRef')} <span className="sk-ident">{order.sellerOrderRef}</span>
            </span>
          ) : null}
          <span className="od-header__spacer" />
        </div>
        <div className="od-header__line od-header__line--facts">
          {/* The phone's copy of the client ref (owner: it never hides).
              CSS shows exactly one of the two, so a screen reader — which
              skips `display: none` — hears it once. */}
          {order.sellerOrderRef ? (
            <span className="od-header__ref od-header__ref--line2" title={order.sellerOrderRef}>
              {t('orderDetail.clientRef')} <span className="sk-ident">{order.sellerOrderRef}</span>
            </span>
          ) : null}
          <span className="od-header__awb">
            <span className="sk-ident">{order.orderNumber}</span>
            <CopyButton value={order.orderNumber} />
          </span>
          <span className="od-header__facts sk-figure">
            {[
              <span key="mode">{order.paymentMode}</span>,
              money !== null ? <Money key="money" amount={money} /> : null,
              order.totalWeightGrams !== null ? (
                <span key="w">{order.totalWeightGrams} g</span>
              ) : null,
              eta !== null ? (
                <span key="eta">{t('orderDetail.header.eta', { date: fmtDay(eta) })}</span>
              ) : null,
            ]
              .filter((x): x is ReactElement => x !== null)
              .map((x, i) => (
                <span key={x.key ?? i} className="od-header__fact">
                  {i > 0 ? (
                    <span aria-hidden className="od-header__dot">
                      ·
                    </span>
                  ) : null}
                  {x}
                </span>
              ))}
          </span>
          <span
            className="od-header__when"
            title={`${fmtStamp(order.placedAt)} · ${fmtStamp(order.updatedAt)}`}
          >
            {placed} · {updated}
          </span>
          <span className="od-header__whenicon">
            <TooltipCard
              layer="fixed"
              title={placed}
              description={updated}
              icon={<Info size={14} />}
            >
              <button
                type="button"
                className="od-iconbtn od-iconbtn--sm"
                aria-label={`${placed} · ${updated}`}
              >
                <Info size={13} aria-hidden />
              </button>
            </TooltipCard>
          </span>
          {primary !== null ? (
            <Button
              variant="primary"
              size="sm"
              icon={primary.icon}
              onClick={primary.onClick}
              className="od-header__primary"
            >
              {primary.label}
            </Button>
          ) : null}
        </div>
        <MenuButton
          label={t('orderDetail.header.more')}
          entries={entries}
          className="od-menu"
          triggerClassName="od-more"
          placement="below"
        />
      </header>
    </>
  );
}
