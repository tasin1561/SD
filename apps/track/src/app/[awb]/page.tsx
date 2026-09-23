import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import { Package, RefreshCw } from 'lucide-react';
import { buttonClassName } from '@skydrop/ui/app/button';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Timeline } from '@skydrop/ui/app/timeline';
import { LazyCorridorMap } from '@skydrop/ui/app/sign-in-map';
import { publicTrackingStatusKind } from '@skydrop/ui/status/public-tracking';
import { apiOrigin } from '@/lib/api-origin';
import type { PublicShipmentDisplayStatus, PublicTrackingResponse } from '@/lib/types';
import { getActiveLocale } from '@/lib/locale';
import { type Locale, statusKey, t } from '@/lib/i18n';
import { TopBar } from '../_components/top-bar';
import { isTerminal, journeyProgress, journeySteps } from './_components/journey';

/**
 * Public AWB detail — the brand skin (apps restyle). A status summary,
 * then the parcel's journey as the u17 timeline: that timeline IS the page.
 *
 * Three outcomes, kept apart on purpose:
 *   - FOUND: the parcel.
 *   - NOT_FOUND: the API's ONE generic 404 body for every miss (TRK-8),
 *     so the page shows a single "not found" and never says why.
 *   - UNAVAILABLE: we could not ask — rate-limited (429), a server error
 *     (5xx), a malformed body, a network failure or a timeout. Showing
 *     "not found" here told a customer their parcel did not exist when
 *     the only thing that failed was the lookup, and gave them nothing
 *     to do but doubt the AWB. This says "try again" and offers it.
 */
type TrackingLookup =
  | { readonly kind: 'found'; readonly data: PublicTrackingResponse }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unavailable' };

/** Long enough for a slow API, short enough that a hung one still
 *  answers the customer instead of spinning until the proxy gives up. */
const LOOKUP_TIMEOUT_MS = 10_000;

async function fetchTracking(awb: string): Promise<TrackingLookup> {
  const url = `${apiOrigin()}/public/tracking/${encodeURIComponent(awb)}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (res.status === 404) return { kind: 'not_found' };
    if (!res.ok) {
      // 429 and 5xx land here, and so does any other unexpected status:
      // none of them is evidence that the parcel does not exist.
      console.error('Tracking lookup failed', { awb, status: res.status });
      return { kind: 'unavailable' };
    }
    return { kind: 'found', data: (await res.json()) as PublicTrackingResponse };
  } catch (e) {
    console.error('Tracking lookup error', { awb, err: (e as Error).message });
    return { kind: 'unavailable' };
  }
}

/** The frame shared by the two "no parcel to show" states. */
function MissShell({ locale, children }: { locale: Locale; children: ReactNode }): ReactElement {
  return (
    <div className="tr-page">
      <LazyCorridorMap className="tr-map" />
      <div aria-hidden className="tr-veil" />
      <div className="tr-wrap tr-wrap--narrow">
        <TopBar locale={locale} />
        <main className="tr-miss">{children}</main>
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
  const lookup = await fetchTracking(decoded);

  if (lookup.kind === 'not_found') {
    return (
      <MissShell locale={locale}>
        <EmptyState
          title={<h1 className="tr-miss__title">{t(locale, 'notFoundTitle')}</h1>}
          description={
            <>
              <span className="tr-miss__awb sk-ident">{decoded}</span>
              <span className="tr-miss__body">{t(locale, 'notFoundBody')}</span>
            </>
          }
          action={
            <Link href="/" className={buttonClassName('primary', 'lg')}>
              {t(locale, 'tryAnother')}
            </Link>
          }
        />
      </MissShell>
    );
  }

  if (lookup.kind === 'unavailable') {
    return (
      <MissShell locale={locale}>
        <div data-tracking-unavailable>
          <EmptyState
            icon={<RefreshCw size={28} />}
            title={<h1 className="tr-miss__title">{t(locale, 'unavailableTitle')}</h1>}
            description={
              <>
                <span className="tr-miss__awb sk-ident">{decoded}</span>
                <span className="tr-miss__body">{t(locale, 'unavailableBody')}</span>
              </>
            }
            action={
              <span className="tr-miss__actions">
                {/* A plain anchor to the same path is a full reload, which
                    re-runs the no-store lookup — no client script needed. */}
                <a
                  href={`/${encodeURIComponent(decoded)}`}
                  className={buttonClassName('primary', 'lg')}
                >
                  {t(locale, 'retry')}
                </a>
                <Link href="/" className={buttonClassName('ghost', 'lg')}>
                  {t(locale, 'tryAnother')}
                </Link>
              </span>
            }
          />
        </div>
      </MissShell>
    );
  }

  const data = lookup.data;
  const kind = publicTrackingStatusKind(data.currentStatus);
  const statusWords = humanizeStatus(data.currentStatus, locale);
  const bcp = localeBcp47(locale);
  const progress = journeyProgress(data.currentStatus);
  const eta =
    data.estimatedDeliveryAt && !isTerminal(data.currentStatus)
      ? new Date(data.estimatedDeliveryAt).toLocaleDateString(bcp)
      : null;

  return (
    <div className="tr-page">
      <LazyCorridorMap className="tr-map tr-map--soft" />
      <div aria-hidden className="tr-veil" />
      <div className="tr-wrap">
        <TopBar locale={locale} trackAnother />

        <section className="tr-card tr-summary" data-status-panel data-kind={kind}>
          <div className="tr-summary__meta">
            <span className="tr-summary__courier">
              <Package size={15} aria-hidden />
              {data.courierDisplayName}
            </span>
            <span className="sk-ident tr-summary__awb">{data.awbNumber}</span>
          </div>
          <StatusChip kind={kind} label={statusWords} size="md" />
          <h1 className="tr-summary__title">{statusWords}</h1>
          <p className="tr-summary__updated">
            {t(locale, 'updated')} {new Date(data.currentStatusAt).toLocaleString(bcp)}
          </p>

          <dl className="tr-facts">
            {/* RS-10: only a reseller store's order carries soldBy —
                the customer bought from THAT business, so that is the
                name they see. Every other order renders as before. */}
            {data.soldBy && (
              <div data-sold-by className="tr-facts__row">
                <dt>{t(locale, 'soldBy')}</dt>
                <dd className="tr-facts__sold">
                  {data.soldBy.logoUrl && (
                    // A 15-minute presigned Spaces URL: next/image would
                    // need the bucket as a remote pattern and would cache
                    // an expiring signature, so a plain <img> is correct.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={data.soldBy.logoUrl}
                      alt=""
                      aria-hidden="true"
                      width={28}
                      height={28}
                      className="tr-facts__logo"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <span>{data.soldBy.name}</span>
                </dd>
              </div>
            )}
            <div className="tr-facts__row">
              <dt>{t(locale, 'destination')}</dt>
              <dd>{data.destinationCity}</dd>
            </div>
            {data.estimatedDeliveryAt && (
              <div className="tr-facts__row">
                <dt>{t(locale, 'estimatedDelivery')}</dt>
                <dd className="sk-figure">
                  {new Date(data.estimatedDeliveryAt).toLocaleDateString(bcp)}
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className="tr-card tr-journey" aria-labelledby="tr-journey-h">
          <h2 id="tr-journey-h" className="tr-journey__title">
            {t(locale, 'timelineHeading')}
          </h2>
          {data.timeline.length === 0 ? (
            <p className="tr-journey__empty">{t(locale, 'noScansYet')}</p>
          ) : (
            <Timeline
              label={t(locale, 'journey')}
              steps={journeySteps(data.timeline, data.currentStatus, locale)}
              {...(progress !== null
                ? { progress: { value: progress, label: t(locale, 'onTheWay') } }
                : {})}
              {...(eta !== null
                ? { expected: { label: t(locale, 'estimatedDelivery'), day: eta } }
                : {})}
              stateWords={{
                done: t(locale, 'stepDone'),
                current: t(locale, 'stepCurrent'),
                todo: t(locale, 'stepTodo'),
                skipped: t(locale, 'stepSkipped'),
              }}
            />
          )}
        </section>
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
