'use client';

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import type { JourneyEntryView, JourneyMilestoneView } from '@skydrop/ui/components';
import { journeyOwnerLabel } from '@skydrop/ui/status';
import { Button } from '@skydrop/ui/app/button';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useLocale, useT } from '@/i18n/client';
import { serverVerdict } from '@/lib/server-verdict';
import { useParcelActivity } from '@/lib/activity-hooks';
import { usePermission } from '@/lib/use-permission';
import { actorLabel } from '@/lib/activity-format';
import { DetailCard } from './detail-card';
import { ACTIVITY_PREVIEW, buildActivity, rowsFor, type ActivityRow } from './order-activity';
import { fmtRowTime, fmtStamp } from './order-detail-format';
import type { ActivityFilter } from './order-detail-ui-state';
import { Details, ICONS, TONE } from './parcel-activity-panel';

const FILTERS: readonly ActivityFilter[] = ['all', 'milestones', 'courier', 'warehouse'];

/**
 * Activity: the tracker's steps, the full history and "who did what" in
 * one card, behind a segmented filter. The rows come from arrays the page
 * already holds (journey) plus the parcel activity read it always made —
 * nothing new is fetched. Eight rows, then "Show all".
 */
export function ActivityCard({
  orderId,
  milestones,
  entries,
  open,
  onOpenChange,
  filter,
  onFilterChange,
  journeyPending = false,
  journeyError = null,
  onRetryJourney,
}: {
  /** The journey read failed or is still loading: said in the card, not hidden. */
  readonly journeyPending?: boolean;
  readonly journeyError?: string | null;
  readonly onRetryJourney?: (() => void) | undefined;
  readonly orderId: string;
  readonly milestones: readonly JourneyMilestoneView[];
  readonly entries: readonly JourneyEntryView[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly filter: ActivityFilter;
  readonly onFilterChange: (filter: ActivityFilter) => void;
}): ReactElement {
  const t = useT();
  const locale = useLocale();
  // The warehouse audit is `orders.view` on the API; `usePermission` only
  // decides whether to SPEND the request (FE-2 — the server is law).
  const mayRead = usePermission('orders.view');
  const trail = useParcelActivity(mayRead ? orderId : '');
  const [expanded, setExpanded] = useState(false);

  const audit = trail.data?.events ?? [];
  const model = buildActivity({
    milestones,
    entries,
    audit,
    actorLabel: (e) => actorLabel(e.actor, t),
    auditText: (e) => t(`activity.step.${e.kind}`),
  });
  // A filter whose tab is not offered (no `orders.view`) falls back to All.
  const active: ActivityFilter = filter === 'warehouse' && !mayRead ? 'all' : filter;
  const rows = rowsFor(model, active);
  const shown = expanded ? rows : rows.slice(0, ACTIVITY_PREVIEW);
  const counts: Record<ActivityFilter, number> = {
    all: model.all.length,
    milestones: model.milestones.length,
    courier: model.courier.length,
    warehouse: model.warehouse.length,
  };
  const labels: Record<ActivityFilter, string> = {
    all: t('orderDetail.activity.all'),
    milestones: t('orderDetail.activity.milestones'),
    courier: t('orderDetail.activity.courierScans'),
    warehouse: t('orderDetail.activity.warehouseAudit'),
  };
  const offered = FILTERS.filter((f) => f !== 'warehouse' || mayRead);

  return (
    <DetailCard
      id="od-activity"
      title={t('orderDetail.activity.title')}
      titleText={t('orderDetail.activity.title')}
      open={open}
      onOpenChange={onOpenChange}
      actions={
        <Segmented
          label={t('orderDetail.activity.filterLabel')}
          value={active}
          onChange={(f) => {
            setExpanded(false);
            onFilterChange(f);
          }}
          items={offered.map((f) => ({ id: f, label: `${labels[f]} (${counts[f]})` }))}
        />
      }
    >
      {journeyPending ? (
        <SkeletonRows rows={3} cols={1} label={t('orderDetail.journeyLoading')} />
      ) : null}
      {journeyError !== null ? (
        <ErrorState
          message={journeyError}
          {...(onRetryJourney === undefined ? {} : { retry: onRetryJourney })}
        />
      ) : null}
      {mayRead && trail.isError ? (
        <ErrorState message={serverVerdict(trail.error)} retry={() => void trail.refetch()} />
      ) : null}
      <div role="status" aria-live="polite" className="od-sr">
        {t('orderDetail.activity.resultCount', { count: shown.length })}
      </div>
      <div role="tabpanel" id="od-activity-panel" aria-labelledby={`od-seg-${active}`}>
        {shown.length === 0 ? (
          <p className="od-empty">{t('orderDetail.activity.empty')}</p>
        ) : (
          <ol className="od-feed">
            {shown.map((r) => (
              <FeedRow key={r.key} row={r} locale={locale} />
            ))}
          </ol>
        )}
      </div>
      {rows.length > ACTIVITY_PREVIEW ? (
        <Button
          variant="ghost"
          size="sm"
          className="od-showall"
          aria-expanded={expanded}
          aria-controls="od-activity-panel"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t('common.showLess') : t('common.showAll', { count: rows.length })}
        </Button>
      ) : null}
    </DetailCard>
  );
}

function FeedRow({
  row,
  locale,
}: {
  readonly row: ActivityRow;
  readonly locale: 'en' | 'bn' | 'hi';
}): ReactElement {
  const t = useT();
  const source =
    row.source === 'WAREHOUSE'
      ? t('orderDetail.activity.source.warehouse')
      : journeyOwnerLabel(row.source, locale === 'bn' ? 'bn' : 'en');
  const tone = row.audit === null ? null : (TONE[row.audit.kind] ?? null);
  return (
    <li
      className="od-feed__row"
      data-source={row.source}
      {...(tone === null ? {} : { 'data-tone': tone })}
    >
      <time className="od-feed__time sk-figure" dateTime={row.at} title={fmtStamp(row.at)}>
        {fmtRowTime(row.at)}
      </time>
      <span className="od-feed__src">{source}</span>
      <span className="od-feed__text">
        {row.audit !== null ? (
          <span className="od-feed__icon" aria-hidden>
            {ICONS[row.audit.kind]}
          </span>
        ) : null}
        {row.text}
        {row.where !== null ? <span className="od-muted"> · {row.where}</span> : null}
        {row.who !== null ? <span className="od-muted"> · {row.who}</span> : null}
        {row.audit !== null ? <Details event={row.audit} /> : null}
      </span>
    </li>
  );
}

/**
 * A segmented control as a WAI-ARIA tablist: roving tabindex, arrows /
 * Home / End move AND select. One indicator slides between segments
 * (transform only; instant under reduced motion).
 */
function Segmented({
  label,
  value,
  onChange,
  items,
}: {
  readonly label: string;
  readonly value: ActivityFilter;
  readonly onChange: (f: ActivityFilter) => void;
  readonly items: ReadonlyArray<{ readonly id: ActivityFilter; readonly label: string }>;
}): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const ready = useRef(false);

  useLayoutEffect(() => {
    const el = root.current;
    if (el === null) return;
    const place = (): void => {
      const active = el.querySelector<HTMLElement>(`[data-seg="${value}"]`);
      if (active === null) return;
      el.style.setProperty('--seg-x', `${active.offsetLeft}px`);
      el.style.setProperty('--seg-w', `${active.offsetWidth}px`);
    };
    place();
    if (!ready.current) {
      window.requestAnimationFrame(() => {
        el.dataset.ready = '1';
      });
      ready.current = true;
    }
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [value, items.length]);

  function onKey(e: KeyboardEvent<HTMLDivElement>): void {
    const i = items.findIndex((x) => x.id === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    const target = items[next];
    if (target === undefined) return;
    e.preventDefault();
    onChange(target.id);
    root.current?.querySelector<HTMLElement>(`[data-seg="${target.id}"]`)?.focus();
  }

  return (
    <div className="od-seg" ref={root} role="tablist" aria-label={label} onKeyDown={onKey}>
      <span className="od-seg__pill" aria-hidden />
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          id={`od-seg-${it.id}`}
          data-seg={it.id}
          aria-selected={it.id === value}
          aria-controls="od-activity-panel"
          tabIndex={it.id === value ? 0 : -1}
          className="od-seg__tab"
          onClick={() => onChange(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
