import type {
  JourneyEntryView,
  JourneyMilestoneView,
  MilestoneOwner,
} from '@skydrop/ui/components';
import type { ParcelActivityEvent } from '@/lib/activity-hooks';
import type { ActivityFilter } from './order-detail-ui-state';

/**
 * The Activity card's rows, built from arrays the page ALREADY has — the
 * journey's tracker steps and full history, and the parcel activity trail.
 * Nothing here fetches.
 *
 *   all        full-history entries (Skydrop, Client, Store and Courier
 *              events) merged with the warehouse audit rows, newest first
 *   milestones the tracker's steps that have happened (or are estimated)
 *   courier    the full-history entries whose owner is the courier
 *   warehouse  the who-did-what rows
 *
 * The tracker steps are a SUMMARY of the history already in `all`, so they
 * are their own lens rather than a third source mixed in (which would list
 * "Handed to courier" twice).
 */
export type ActivitySource = MilestoneOwner | 'WAREHOUSE';

export interface ActivityRow {
  readonly key: string;
  /** ISO instant — the sort key and the `title` on the time. */
  readonly at: string;
  readonly source: ActivitySource;
  readonly kind: 'event' | 'milestone' | 'audit';
  readonly text: string;
  /** Location (events) — muted, after the text. */
  readonly where: string | null;
  /** Actor (audit rows) — muted, after the text. */
  readonly who: string | null;
  readonly audit: ParcelActivityEvent | null;
  readonly estimated: boolean;
}

export interface ActivityModel {
  readonly all: readonly ActivityRow[];
  readonly milestones: readonly ActivityRow[];
  readonly courier: readonly ActivityRow[];
  readonly warehouse: readonly ActivityRow[];
}

const byNewest = (a: ActivityRow, b: ActivityRow): number =>
  new Date(b.at).getTime() - new Date(a.at).getTime();

export function buildActivity({
  milestones,
  entries,
  audit,
  actorLabel,
  auditText,
}: {
  readonly milestones: readonly JourneyMilestoneView[];
  readonly entries: readonly JourneyEntryView[];
  readonly audit: readonly ParcelActivityEvent[];
  readonly actorLabel: (event: ParcelActivityEvent) => string;
  readonly auditText: (event: ParcelActivityEvent) => string;
}): ActivityModel {
  const events: ActivityRow[] = entries.map((e, i) => ({
    key: `e-${i}-${e.at}`,
    at: e.at,
    source: e.owner,
    kind: 'event',
    text: e.title,
    where: e.location,
    who: null,
    audit: null,
    estimated: false,
  }));
  const rows: ActivityRow[] = audit.map((a) => ({
    key: `a-${a.key}`,
    at: a.atIso,
    source: 'WAREHOUSE',
    kind: 'audit',
    text: auditText(a),
    where: null,
    who: actorLabel(a),
    audit: a,
    estimated: false,
  }));
  const steps: ActivityRow[] = milestones
    .filter((m) => m.at !== null)
    .map((m) => ({
      key: `m-${m.key}`,
      at: m.at as string,
      source: m.owner,
      kind: 'milestone',
      text: m.label,
      where: m.detail,
      who: null,
      audit: null,
      estimated: m.estimated,
    }));
  return {
    all: [...events, ...rows].sort(byNewest),
    milestones: steps.sort(byNewest),
    courier: events.filter((e) => e.source === 'COURIER').sort(byNewest),
    warehouse: [...rows].sort(byNewest),
  };
}

export function rowsFor(model: ActivityModel, filter: ActivityFilter): readonly ActivityRow[] {
  switch (filter) {
    case 'milestones':
      return model.milestones;
    case 'courier':
      return model.courier;
    case 'warehouse':
      return model.warehouse;
    default:
      return model.all;
  }
}

/** Rows shown before "Show all". */
export const ACTIVITY_PREVIEW = 8;
