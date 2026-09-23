import { TriangleAlert } from 'lucide-react';
import type { TimelineStep, TimelineTone } from '@skydrop/ui/app/timeline';
import { type Locale, statusKey, t } from '@/lib/i18n';
import type { PublicShipmentDisplayStatus, PublicTrackingTimelineEvent } from '@/lib/types';

/**
 * The parcel's journey as timeline steps — pure, no React state.
 *
 * The scans come from the API newest-first; the journey reads top-down in
 * time (oldest first), the way a route is travelled. Every scan is a step
 * that happened; the latest is the CURRENT step unless it ends the journey.
 * After it come the milestones still ahead — derived from where the parcel
 * is on its chain, never invented beyond it — so the customer sees what
 * is left, not only what has passed.
 *
 * Status words, times and places are exactly what the page showed before;
 * only the order and the "still to come" rows are new.
 */
const FORWARD: readonly PublicShipmentDisplayStatus[] = [
  'processing',
  'dispatched',
  'in_transit',
  'out_for_delivery',
  'delivered',
];
const RETURN: readonly PublicShipmentDisplayStatus[] = [
  'return_initiated',
  'returning',
  'returned',
];
const TERMINAL: ReadonlySet<PublicShipmentDisplayStatus> = new Set([
  'delivered',
  'returned',
  'lost',
  'damaged',
  'cancelled',
]);

export function isTerminal(s: PublicShipmentDisplayStatus): boolean {
  return TERMINAL.has(s);
}

function toneOf(s: PublicShipmentDisplayStatus): TimelineTone {
  if (s === 'delivery_attempted' || s === 'lost' || s === 'damaged' || s === 'cancelled') {
    return 'failed';
  }
  if (RETURN.includes(s)) return 'returning';
  return 'default';
}

/** Where a status sits on the forward chain (an attempt is at "out for delivery"). */
function forwardIndex(s: PublicShipmentDisplayStatus): number {
  return s === 'delivery_attempted' ? FORWARD.indexOf('out_for_delivery') : FORWARD.indexOf(s);
}

function stillToCome(current: PublicShipmentDisplayStatus): PublicShipmentDisplayStatus[] {
  if (isTerminal(current)) return [];
  const r = RETURN.indexOf(current);
  if (r >= 0) return RETURN.slice(r + 1);
  const f = forwardIndex(current);
  return f >= 0 ? FORWARD.slice(f + 1) : [];
}

export function journeySteps(
  events: ReadonlyArray<PublicTrackingTimelineEvent>,
  current: PublicShipmentDisplayStatus,
  locale: Locale,
): TimelineStep[] {
  const bcp = locale === 'hi' ? 'hi-IN' : 'en-IN';
  const chronological = [...events].reverse();
  const last = chronological.length - 1;
  const done: TimelineStep[] = chronological.map((e, i) => ({
    id: `scan-${i}`,
    label: t(locale, statusKey(e.status)),
    state: i === last && !isTerminal(e.status) ? 'current' : 'done',
    tone: toneOf(e.status),
    // An attempt is the one state a customer may need to act on — a
    // warning, not the cross a lost or cancelled parcel gets.
    ...(e.status === 'delivery_attempted' ? { icon: <TriangleAlert size={12} /> } : {}),
    time: new Date(e.eventAt).toLocaleString(bcp),
    ...(e.description ? { description: e.description } : {}),
    ...(e.locationCity ? { location: e.locationCity } : {}),
  }));
  const ahead: TimelineStep[] = stillToCome(current).map((s) => ({
    id: `next-${s}`,
    label: t(locale, statusKey(s)),
    state: 'todo',
  }));
  return [...done, ...ahead];
}

/** "On the way" progress, only while the parcel is moving forward. */
export function journeyProgress(current: PublicShipmentDisplayStatus): number | null {
  if (isTerminal(current) || RETURN.includes(current)) return null;
  const f = forwardIndex(current);
  return f < 0 ? null : Math.round(((f + 1) / FORWARD.length) * 100);
}
