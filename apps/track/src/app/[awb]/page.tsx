import type { ReactElement } from 'react';
import Link from 'next/link';
import { apiOrigin } from '@/lib/api-origin';
import type { PublicShipmentDisplayStatus, PublicTrackingResponse } from '@/lib/types';
import { TimelineView } from './_components/timeline-view';
import { LocaleSwitcher } from '../_components/locale-switcher';
import { getActiveLocale } from '@/lib/locale';
import { type Locale, statusKey, t } from '@/lib/i18n';

/**
 * Public AWB detail. Server-side fetches the customer-safe projection
 * from /public/tracking/:awb and renders. The API returns the same
 * generic 404 body for every miss (unknown, soft-deleted, unissued) —
 * TRK-8 anti-enumeration — so the page shows a single "not found"
 * regardless. Bilingual via the `lang` cookie.
 */
async function fetchTracking(
  awb: string,
): Promise<PublicTrackingResponse | null> {
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
      <div className="min-h-screen grid place-items-center bg-bg text-text-body p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center relative">
            <Link href="/" className="text-text-bright font-semibold text-2xl tracking-tight">
              {t(locale, 'brand')}
            </Link>
            <div className="text-text-faint text-xs mt-1">{t(locale, 'tagline')}</div>
            <div className="absolute right-0 top-1">
              <LocaleSwitcher active={locale} />
            </div>
          </div>
          <div className="rounded-[7px] border border-border bg-surface p-6">
            <h1 className="text-text-bright text-base font-semibold mb-1">
              {t(locale, 'notFoundTitle')}
            </h1>
            <p className="text-text-muted text-xs mb-3">
              <span className="font-mono text-text-bright">{decoded}</span>
            </p>
            <p className="text-text-muted text-xs mb-4">
              {t(locale, 'notFoundBody')}
            </p>
            <Link
              href="/"
              className="inline-block px-3 py-1.5 rounded-[5px] bg-accent text-accent-fg text-sm font-medium hover:bg-accent-hover transition-colors"
            >
              {t(locale, 'tryAnother')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-text-body p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6 flex items-baseline justify-between gap-3">
          <Link href="/" className="text-text-bright font-semibold text-lg tracking-tight">
            {t(locale, 'brand')}
          </Link>
          <div className="flex items-center gap-3">
            <LocaleSwitcher active={locale} />
            <Link
              href="/"
              className="text-text-muted hover:text-text-body text-xs"
            >
              {t(locale, 'trackAnother')}
            </Link>
          </div>
        </div>

        <div className="rounded-[7px] border border-border bg-surface p-5 mb-4">
          <div className="text-text-faint text-xs uppercase tracking-wide mb-1">
            {data.courierDisplayName}
          </div>
          <div className="text-text-bright font-mono text-sm mb-3">
            {data.awbNumber}
          </div>
          <div className="text-text-bright text-2xl font-semibold tracking-tight">
            {humanizeStatus(data.currentStatus, locale)}
          </div>
          <div className="text-text-muted text-xs mt-1">
            {t(locale, 'updated')}{' '}
            {new Date(data.currentStatusAt).toLocaleString(localeBcp47(locale))}
          </div>
          <div className="mt-3 pt-3 border-t border-border text-xs text-text-muted">
            <div>
              <span className="text-text-faint">{t(locale, 'destination')}: </span>
              <span className="text-text-body">{data.destinationCity}</span>
            </div>
            {data.estimatedDeliveryAt && (
              <div className="mt-1">
                <span className="text-text-faint">
                  {t(locale, 'estimatedDelivery')}:{' '}
                </span>
                <span className="text-text-body">
                  {new Date(data.estimatedDeliveryAt).toLocaleDateString(
                    localeBcp47(locale),
                  )}
                </span>
              </div>
            )}
          </div>
        </div>

        <h2 className="text-text-bright text-sm font-medium mb-2">
          {t(locale, 'timelineHeading')}
        </h2>
        <TimelineView events={data.timeline} locale={locale} />
      </div>
    </div>
  );
}

function humanizeStatus(
  s: PublicShipmentDisplayStatus,
  locale: Locale,
): string {
  return t(locale, statusKey(s));
}

function localeBcp47(l: Locale): string {
  return l === 'hi' ? 'hi-IN' : 'en-IN';
}
