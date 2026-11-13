import type {
  PublicTrackingResponse,
  PublicTrackingTimelineEvent,
} from '../tracking-public/dto/public-tracking.response.dto';

/**
 * THE public-helper guard (TRK-8).
 *
 * The only data the public parcel helper can ever see is what
 * `PublicTrackingReadService.findByAwb` returns, because it is the SAME call
 * the public page makes. This module is the second lock: it copies an
 * ALLOW-LIST of keys out of that projection (never "everything but the
 * private ones"), so a field added to the projection later, or a field a
 * future change drags in by mistake, reaches the model only if somebody
 * adds it HERE, in a diff that says so. `assistant-public-parcel.spec.ts`
 * pins the exact key sets.
 *
 * `soldBy` is deliberately NOT in the list: the page shows a store's name and
 * logo, but the helper has no reason to talk about who sold the parcel, and
 * "nothing about the seller" is the safer default.
 */
export const PARCEL_FACT_KEYS = [
  'awbNumber',
  'courierDisplayName',
  'currentStatus',
  'currentStatusAt',
  'destinationCity',
  'estimatedDeliveryAt',
  'timeline',
] as const;

export const PARCEL_TIMELINE_KEYS = ['status', 'eventAt', 'description', 'locationCity'] as const;

/** The whole of what the model sees: the allow-listed projection plus the server clock. */
export interface ParcelFacts {
  readonly parcel: {
    readonly awbNumber: string;
    readonly courierDisplayName: string;
    readonly currentStatus: string;
    readonly currentStatusAt: string;
    readonly destinationCity: string;
    readonly estimatedDeliveryAt: string | null;
    readonly timeline: ReadonlyArray<{
      readonly status: string;
      readonly eventAt: string;
      readonly description: string | null;
      readonly locationCity: string | null;
    }>;
  };
  /** The server's clock, so "is it late?" is answered from a date, not a guess. */
  readonly asOf: string;
}

/** A description is free text from a courier scan: bounded, and treated as data by the prompt. */
const MAX_DESCRIPTION_CHARS = 200;
/** The page shows the whole journey; a runaway timeline must not fill the prompt. */
const MAX_TIMELINE_EVENTS = 40;

function event(e: PublicTrackingTimelineEvent): ParcelFacts['parcel']['timeline'][number] {
  return {
    status: e.status,
    eventAt: e.eventAt,
    description: e.description === null ? null : e.description.slice(0, MAX_DESCRIPTION_CHARS),
    locationCity: e.locationCity,
  };
}

export function toParcelFacts(p: PublicTrackingResponse, now: Date = new Date()): ParcelFacts {
  return {
    parcel: {
      awbNumber: p.awbNumber,
      courierDisplayName: p.courierDisplayName,
      currentStatus: p.currentStatus,
      currentStatusAt: p.currentStatusAt,
      destinationCity: p.destinationCity,
      estimatedDeliveryAt: p.estimatedDeliveryAt,
      timeline: p.timeline.slice(0, MAX_TIMELINE_EVENTS).map(event),
    },
    asOf: now.toISOString(),
  };
}

/** What the tool needs from the tracking module: the page's own read, nothing else. */
export interface PublicParcelReader {
  findByAwb(awbNumber: string): Promise<PublicTrackingResponse>;
}

/**
 * An AWB as the public route accepts it. Anything else gets the SAME 404 the
 * page gets for an unknown number, so a malformed value is not told apart
 * from a missing one.
 */
export const PUBLIC_AWB_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

export function isPublicAwb(value: unknown): value is string {
  return typeof value === 'string' && PUBLIC_AWB_PATTERN.test(value.trim());
}
