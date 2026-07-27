import type { ReactElement } from 'react';
import Link from 'next/link';
import { apiOrigin } from '@/lib/api-origin';
import type { PublicShipmentDisplayStatus, PublicTrackingResponse } from '@/lib/types';
import { TimelineView } from './_components/timeline-view';
import { LocaleSwitcher } from '../_components/locale-switcher';
import { ThemeToggle } from '../_components/theme-toggle';
import { getActiveLocale } from '@/lib/locale';
import { TiltPanel } from '@/lib/tilt';
import { CorridorConsole } from '../_components/corridor-console';
import { type Locale, statusKey, t } from '@/lib/i18n';

/**
 * Public AWB detail — MISSION CONTROL skin. Status card as an
 * instrument panel; scan history as a console event log. The API
 * returns one generic 404 body for every miss (TRK-8) so the page
 * shows a single "not found" regardless.
 */
async function fetchTracking(awb: string): Promise<PublicTrackingResponse | null> {
  const url = `${apiOrigin()}/public/tracking/${encodeURIComponent(awb)}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      console.error('Tracking lookup failed', { awb, status: res.status });
      return null;
    }
    return (await res.json()) as PublicTrackingResponse;
  } catch (e) {
    console.error('Tracking lookup error', { awb, err: (e as Error).message });
    return null;
  }
}

const STATUS_TONE: Record<string, string> = {
  delivered: 'var(--green)',
  out_for_delivery: 'var(--sky)',
  in_transit: 'var(--sky)',
  dispatched: 'var(--sky)',
  delivery_attempted: 'var(--saffron)',
  processing: 'var(--fg-muted)',
  return_initiated: 'var(--fg-muted)',
  returning: 'var(--fg-muted)',
  returned: 'var(--fg-muted)',
  lost: 'var(--red)',
  damaged: 'var(--red)',
  cancelled: 'var(--fg-muted)',
};

function Header({ locale }: { locale: Locale }): ReactElement {
  return (
    <div className="mb-6 flex items-baseline justify-between gap-3">
      <Link href="/" className="flex items-baseline gap-3">
        <span className="font-display font-semibold text-lg tracking-tight text-fg-strong">
          {t(locale, 'brand')}
        </span>
        <span className="telemetry hidden sm:inline-flex items-center gap-1.5 text-fg-muted">
          <span aria-hidden className="status-dot inline-block h-1 w-1 rounded-full bg-green" />
          sys online
        </span>
      </Link>
      <div className="flex items-center gap-2 sm:gap-3">
        <ThemeToggle />
        <LocaleSwitcher active={locale} />
        <Link
          href="/"
          className="hidden sm:inline text-fg-muted hover:text-fg-strong text-xs transition-colors"
        >
          {t(locale, 'trackAnother')}
        </Link>
      </div>
    </div>
  );
}

export default async function AwbPage({
  params,
}: {
  params: Promise<{ awb: string }>;
}): Promise<ReactElement> {
  const { awb } = await params;
  const decoded = decodeURIComponent(awb);
  const locale = await getActiveLocale();
  const data = await fetchTracking(decoded);

  if (!data) {
    return (
      <div className="relative min-h-screen grid place-items-center bg-surface text-fg-body p-6 overflow-hidden">
        <div aria-hidden className="console-grid absolute inset-0" />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-55">
          <CorridorConsole />
        </div>
        <div className="absolute top-4 right-4 sm:top-5 sm:right-6 z-20 flex items-center gap-2">
          <ThemeToggle />
          <LocaleSwitcher active={locale} />
        </div>
        <div className="relative w-full max-w-md">
          <div className="mb-8 text-center">
            <Link
              href="/"
              className="font-display font-semibold text-2xl tracking-tight text-fg-strong"
            >
              {t(locale, 'brand')}
            </Link>
            <div className="telemetry text-fg-muted mt-2">{t(locale, 'tagline')}</div>
          </div>
          <div className="panel ticks p-6 sm:p-7">
            <div className="telemetry text-saffron mb-3">no signal</div>
            <h1 className="text-fg-strong text-lg font-semibold mb-2">
              {t(locale, 'notFoundTitle')}
            </h1>
            <p className="font-mono text-sm text-fg-strong mb-2">{decoded}</p>
            <p className="text-fg-muted text-sm mb-5">{t(locale, 'notFoundBody')}</p>
            <Link
              href="/"
              className="inline-flex items-center justify-center h-11 px-5 rounded-xl bg-sky text-accent-fg text-sm font-medium hover:bg-sky-deep transition-colors"
            >
              {t(locale, 'tryAnother')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const tone = STATUS_TONE[data.currentStatus] ?? 'var(--sky)';

  return (
    <div className="relative min-h-screen bg-surface text-fg-body p-5 sm:p-6 overflow-hidden">
      <div aria-hidden className="console-grid absolute inset-0 opacity-60" />
      <div aria-hidden className="pointer-events-none fixed inset-0 opacity-40">
        <CorridorConsole />
      </div>
      <div className="relative max-w-2xl mx-auto pt-2">
        <Header locale={locale} />

        {/* Status instrument */}
        <TiltPanel max={2.5} className="boot-rise mb-5">
          <div className="panel ticks relative overflow-hidden p-6 sm:p-7">
            <div className="flex items-baseline justify-between gap-3 mb-4">
              <span className="telemetry text-fg-muted">{data.courierDisplayName}</span>
              <span className="telemetry text-sky">{data.awbNumber}</span>
            </div>
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className={`status-dot relative inline-block h-2.5 w-2.5 rounded-full shrink-0${
                  data.currentStatus === 'delivered' ? ' delivered-ring' : ''
                }`}
                style={{ background: tone }}
              />
              <h1
                className="font-display text-2xl sm:text-3xl font-semibold tracking-tight"
                style={{ color: tone }}
              >
                {humanizeStatus(data.currentStatus, locale)}
              </h1>
            </div>
            <div className="telemetry text-fg-muted mt-2">
              {t(locale, 'updated')}{' '}
              {new Date(data.currentStatusAt).toLocaleString(localeBcp47(locale))}
            </div>

            <dl className="mt-5 pt-5 border-t border-line grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="telemetry text-fg-muted mb-1">{t(locale, 'destination')}</dt>
                <dd className="text-fg-strong m-0">{data.destinationCity}</dd>
              </div>
              {data.estimatedDeliveryAt && (
                <div>
                  <dt className="telemetry text-fg-muted mb-1">{t(locale, 'estimatedDelivery')}</dt>
                  <dd className="text-fg-strong m-0 font-mono">
                    {new Date(data.estimatedDeliveryAt).toLocaleDateString(localeBcp47(locale))}
                  </dd>
                </div>
              )}
            </dl>
            <div aria-hidden className="glow-follow" />
          </div>
        </TiltPanel>

        {/* Event log */}
        <div className="boot-rise boot-rise-2 telemetry text-fg-muted mb-3 flex items-center gap-3">
          <span className="text-sky">{t(locale, 'timelineHeading')}</span>
          <span aria-hidden className="inline-block h-px flex-1 bg-line-strong" />
        </div>
        <TimelineView events={data.timeline} locale={locale} />
      </div>
    </div>
  );
}

function humanizeStatus(s: PublicShipmentDisplayStatus, locale: Locale): string {
  return t(locale, statusKey(s));
}

function localeBcp47(l: Locale): string {
  return l === 'hi' ? 'hi-IN' : 'en-IN';
}
