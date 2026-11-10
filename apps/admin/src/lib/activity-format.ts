'use client';

import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';
import type { TrailActor } from './activity-hooks';

/**
 * How an actor and an instant are WORDED. One place, two screens.
 *
 * ── NAMES, NEVER IDS, AND NEVER A FABRICATED ONE ─────────────────────
 * A staff display name is data and is printed as it arrives. Every other
 * outcome has its own sentence: a staff member who has left keeps their
 * name with "(has left)" beside it, an automatic step reads as the
 * system, a step with nowhere to record an actor reads as "not
 * recorded", and an id that resolves to nothing reads as not found.
 * Nothing here can render "undefined" or an empty cell.
 */
export function actorLabel(actor: TrailActor, t: Translate<MessageKey>): string {
  switch (actor.kind) {
    case 'STAFF':
      return actor.name ?? t('activity.actor.unknown');
    case 'STAFF_REMOVED':
      return actor.name === null
        ? t('activity.actor.unknown')
        : t('activity.actor.removed', { name: actor.name });
    case 'SYSTEM':
      return t('activity.actor.system');
    case 'SELLER':
      return t('activity.actor.seller');
    case 'STORE':
      return t('activity.actor.store');
    case 'STAFF_AS_CLIENT':
      return t('activity.actor.staffAsClient');
    case 'API':
      return t('activity.actor.api');
    case 'COURIER':
      return t('activity.actor.courier');
    case 'UNRECORDED':
      return t('activity.actor.unrecorded');
    case 'UNKNOWN':
      return t('activity.actor.unknown');
    default:
      return t('activity.actor.unknown');
  }
}

/** True for the rows where there is no person to point at. */
export function actorIsPerson(actor: TrailActor): boolean {
  return (actor.kind === 'STAFF' || actor.kind === 'STAFF_REMOVED') && actor.name !== null;
}

/**
 * An instant as a CLOCK TIME: `10 Nov, 2:05 pm`.
 *
 * Always `en-IN`, in every language, for the same reason the catalogue
 * forbids Bengali digits: the floor reads times, AWBs and counts in
 * Western numerals, and a date that changes script between two columns
 * of the same row is harder to read, not friendlier.
 *
 * Never relative. "In 23 minutes" is true for one minute and silently
 * wrong for the next twenty-two, and this screen is left open.
 */
export function clockTime(iso: string | null): string {
  if (iso === null) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  return at.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
