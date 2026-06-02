import type { ReactElement } from 'react';
import Link from 'next/link';
import { apiOrigin } from '@/lib/api-origin';
import type { PublicTrackingResponse } from '@/lib/types';
import { TimelineView } from './_components/timeline-view';

/**
 * Public AWB detail. Server-side fetches the customer-safe projection
 * from /public/tracking/:awb and renders. The API returns the same
 * generic 404 body for every miss (unknown, soft-deleted, unissued) —
 * TRK-8 anti-enumeration — so the page shows a single "not found"
 * regardless.
 *
 * Phase 1A: English only. Hindi follows in a small follow-up.
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
  const data = await fetchTracking(decoded);

  if (!data) {
    return (
      <div className="min-h-screen grid place-items-center bg-bg text-text-body p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <Link href="/" className="text-text-bright font-semibold text-2xl tracking-tight">
              Skydrop
            </Link>
            <div className="text-text-faint text-xs mt-1">Parcel tracking</div>
          </div>
          <div className="rounded-[7px] border border-border bg-surface p-6">
            <h1 className="text-text-bright text-base font-semibold mb-1">
              Tracking number not found
            </h1>
            <p className="text-text-muted text-xs mb-4">
              We couldn&apos;t find a parcel for{' '}
              <span className="font-mono text-text-bright">{decoded}</span>.
              Double-check the number from your confirmation email or SMS.
              Tracking may take up to 24 hours to become active after
              dispatch.
            </p>
            <Link
              href="/"
              className="inline-block px-3 py-1.5 rounded-[5px] bg-accent text-accent-fg text-sm font-medium hover:bg-accent-hover transition-colors"
            >
              Try another AWB
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-text-body p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6 flex items-baseline justify-between">
          <Link href="/" className="text-text-bright font-semibold text-lg tracking-tight">
            Skydrop
          </Link>
          <Link
            href="/"
            className="text-text-muted hover:text-text-body text-xs"
          >
            Track another
          </Link>
        </div>

        <div className="rounded-[7px] border border-border bg-surface p-5 mb-4">
          <div className="text-text-faint text-xs uppercase tracking-wide mb-1">
            {data.courierDisplayName}
          </div>
          <div className="text-text-bright font-mono text-sm mb-3">
            {data.awbNumber}
          </div>
          <div className="text-text-bright text-2xl font-semibold tracking-tight">
            {humanizeStatus(data.currentStatus)}
          </div>
          <div className="text-text-muted text-xs mt-1">
            Updated {new Date(data.currentStatusAt).toLocaleString()}
          </div>
          <div className="mt-3 pt-3 border-t border-border text-xs text-text-muted">
            <div>
              <span className="text-text-faint">Destination: </span>
              <span className="text-text-body">{data.destinationCity}</span>
            </div>
            {data.estimatedDeliveryAt && (
              <div className="mt-1">
                <span className="text-text-faint">Estimated delivery: </span>
                <span className="text-text-body">
                  {new Date(data.estimatedDeliveryAt).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>
        </div>

        <h2 className="text-text-bright text-sm font-medium mb-2">Timeline</h2>
        <TimelineView events={data.timeline} />
      </div>
    </div>
  );
}

function humanizeStatus(s: PublicTrackingResponse['currentStatus']): string {
  switch (s) {
    case 'processing':
      return 'Processing';
    case 'dispatched':
      return 'Dispatched';
    case 'in_transit':
      return 'In transit';
    case 'out_for_delivery':
      return 'Out for delivery';
    case 'delivery_attempted':
      return 'Delivery attempted';
    case 'delivered':
      return 'Delivered';
    case 'return_initiated':
      return 'Return initiated';
    case 'returning':
      return 'Returning';
    case 'returned':
      return 'Returned';
    case 'lost':
      return 'Lost';
    case 'damaged':
      return 'Damaged';
    case 'cancelled':
      return 'Cancelled';
  }
}
