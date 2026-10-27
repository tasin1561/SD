'use client';

import type { ReactElement, ReactNode } from 'react';
import { Route } from 'lucide-react';
import {
  JourneyTimeline,
  ParcelFacts,
  type JourneyEntryView,
  type JourneyMilestoneView,
  type JourneyParcelView,
} from '@skydrop/ui/components';
import { Timeline, type TimelineStep, type TimelineStepState } from '@skydrop/ui/app/timeline';
import { journeyOwnerLabel } from '@skydrop/ui/status';
import { OrdSection } from './orders-parts';
import { useLocale, useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';
import type { Locale } from '@skydrop/ui/app/i18n';

/**
 * The order journey, drawn as the u17 timeline.
 *
 * Display only. The milestones, the parcel and the history entries are
 * exactly what `/journey` returns and what the shared `OrderJourneyPanels`
 * drew; the stage ladder becomes the timeline (filled connector, the
 * current stage pulsing, a time chip per stage), and the parcel facts and
 * the full history keep the shared renderers so every word and time they
 * print is unchanged.
 */

/** `12 Sep 2026, 2:52 pm` — the ladder's own format, unchanged. */
function fmt(at: string | null): string {
  if (at === null) return '—';
  return new Date(at).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** `12 Sep 2026` — for an estimated date, which has no time. */
function fmtDate(at: string | null): string {
  if (at === null) return '—';
  return new Date(at).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const STATE: Record<JourneyMilestoneView['state'], TimelineStepState> = {
  DONE: 'done',
  CURRENT: 'current',
  PENDING: 'todo',
  SKIPPED: 'skipped',
};

/** Milestones → timeline steps. Same labels, same owner word, same times. */
export function milestoneSteps(
  milestones: readonly JourneyMilestoneView[],
  t: Translate<MessageKey>,
  locale: Locale = 'en',
): TimelineStep[] {
  return milestones.map((m) => {
    const owner = journeyOwnerLabel(m.owner, locale);
    const description: ReactNode = (
      <>
        <span>{owner}</span>
        {m.state === 'SKIPPED' && <span> · {t('orderDetail.notNeeded')}</span>}
        {m.detail !== null && <span className="ord-sub">{m.detail}</span>}
      </>
    );
    return {
      id: m.key,
      label: m.label,
      state: STATE[m.state],
      description,
      ...(m.at === null
        ? {}
        : {
            time: m.estimated ? t('orderDetail.estimatedDate', { date: fmtDate(m.at) }) : fmt(m.at),
          }),
    };
  });
}

export function OrderJourney({
  orderNumber,
  status,
  milestones,
  parcels,
  entries,
  allParcelsHref,
  trackingUrlBase,
}: {
  readonly orderNumber: string;
  /** A ready `StatusChip` for the order. */
  readonly status: ReactNode;
  readonly milestones: readonly JourneyMilestoneView[];
  readonly parcels: readonly JourneyParcelView[];
  readonly entries: readonly JourneyEntryView[];
  readonly allParcelsHref: string;
  readonly trackingUrlBase: string;
}): ReactElement {
  const t = useT();
  const locale = useLocale();
  // The latest parcel, as the shared panels chose it.
  const parcel = parcels[parcels.length - 1] ?? null;
  return (
    <div className="ord-stack">
      <OrdSection title={t('orderDetail.orderTracker')} note={t('orderDetail.whereThisOrderHas')}>
        <Timeline
          label={t('orderDetail.orderTracker')}
          steps={milestoneSteps(milestones, t, locale)}
          header={{
            icon: <Route size={16} />,
            title: t('orderDetail.order'),
            id: orderNumber,
            status,
          }}
        />
      </OrdSection>
      {parcel !== null && (
        <OrdSection title={t('orderDetail.parcel')} note={t('orderDetail.whatTheCourierSays')}>
          <ParcelFacts
            parcel={parcel}
            allParcelsHref={allParcelsHref}
            trackingUrlBase={trackingUrlBase}
          />
        </OrdSection>
      )}
      <OrdSection title={t('orderDetail.fullHistory')} note={t('orderDetail.ourHandlingAndThe')}>
        <JourneyTimeline entries={entries} />
      </OrdSection>
    </div>
  );
}
