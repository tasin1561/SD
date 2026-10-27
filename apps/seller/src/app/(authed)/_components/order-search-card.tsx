import type { ReactElement } from 'react';
import type { OrderListItem } from '@skydrop/api-client';
import { courierLabel } from '@skydrop/ui/status';
import { useLocale, useT } from '@/i18n/client';
import { formatDate } from '@/i18n/format';

/** `650 g` under a kilo, `1.25 kg` over it. */
export function formatWeight(grams: number): string {
  return grams >= 1000 ? `${Number((grams / 1000).toFixed(2))} kg` : `${grams} g`;
}

/** `10 × 8 × 5 cm`, or null unless all three sides are known. */
export function formatDimensions(s: {
  readonly lengthCm: number | null;
  readonly widthCm: number | null;
  readonly heightCm: number | null;
}): string | null {
  if (s.lengthCm === null || s.widthCm === null || s.heightCm === null) return null;
  const n = (v: number): string => String(Number(v.toFixed(2)));
  return `${n(s.lengthCm)} × ${n(s.widthCm)} × ${n(s.heightCm)} cm`;
}

function Fact({ label, children }: { label: string; children: string }): ReactElement {
  return (
    <div className="min-w-0">
      <dt className="text-text-faint text-[10px] tracking-wide uppercase">{label}</dt>
      <dd className="text-text-muted min-w-0 text-xs [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/**
 * One search match: who, which order, when, where it stands, and what is
 * known of its parcel. Every grid child is `min-w-0` and wraps anywhere,
 * so eight facts stay inside a 400px panel instead of pushing it wider.
 * An order with no parcel yet says so once, quietly, rather than showing
 * a column of empty fields.
 */
export function OrderSearchCard({
  order,
  statusText,
}: {
  order: OrderListItem;
  statusText: string;
}): ReactElement {
  const t = useT();
  const locale = useLocale();
  const s = order.shipment ?? null;
  const size = s === null ? null : formatDimensions(s);
  const weight = s?.weightGrams ?? order.totalWeightGrams ?? null;
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="text-text-bright min-w-0 flex-1 truncate text-sm font-medium">
          {order.recipientName}
        </span>
        <span className="border-border bg-surface-raised text-text-muted shrink-0 rounded-full border px-2 py-0.5 text-[10px] tracking-wide uppercase">
          {statusText}
        </span>
      </div>
      <div className="text-text-muted flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs">
        <span className="font-mono">{order.orderNumber}</span>
        <span className="[overflow-wrap:anywhere]">{order.recipientPhoneE164}</span>
      </div>
      <dl className="mt-1.5 grid min-w-0 grid-cols-2 gap-x-3 gap-y-1">
        <Fact label={t('authedShell.card.placed')}>{formatDate(order.placedAt, locale)}</Fact>
        {weight !== null && (
          <Fact label={t('authedShell.card.weight')}>{formatWeight(weight)}</Fact>
        )}
        {size !== null && <Fact label={t('authedShell.card.size')}>{size}</Fact>}
        {s !== null && (
          <Fact label={t('authedShell.card.courier')}>
            {courierLabel(s.courierDisplayName ?? s.courierCode, s.manualCourierName)}
          </Fact>
        )}
        {s !== null && (
          <Fact label={t('authedShell.card.awb')}>
            {s.awbNumber ?? t('authedShell.card.awbPending')}
          </Fact>
        )}
      </dl>
      {s === null && (
        <p className="text-text-faint mt-1 text-[11px] italic">
          {t('authedShell.card.notDispatched')}
        </p>
      )}
    </div>
  );
}
