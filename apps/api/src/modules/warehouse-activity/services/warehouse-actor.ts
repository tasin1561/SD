/**
 * Who did it — turned into something a person can read.
 *
 * ── WHY A DERIVED NAME AND NOT THE EMAIL ─────────────────────────────
 * `staff_users` carries NO name column (only `email` / `emailDisplay`),
 * so there is no stored display name to show. The floor asked for names
 * rather than ids, and an email is barely better than a uuid on a trail
 * somebody reads twenty rows of, so the login's LOCAL PART is humanised
 * here: `rakib.hasan@skydrop.global` reads as "Rakib Hasan". It is a
 * label derived from a fact, never invented — and the day
 * `staff_users.full_name` exists, this function is the one place that
 * changes.
 *
 * ── DEGRADING HONESTLY IS THE WHOLE POINT ────────────────────────────
 * Five outcomes, each its own KIND so the screen can word it itself
 * (i18n lives in the console, not in this string):
 *
 *   STAFF         — a live staff member; `name` is set.
 *   STAFF_REMOVED — a soft-deleted staff member. The name still shows:
 *                   the act really was theirs, and blanking it would
 *                   quietly rewrite history.
 *   SYSTEM        — the act carries no staff id because no person did
 *                   it (a backfill, an automatic transition).
 *   UNRECORDED    — nobody is recorded against this step because the
 *                   schema has nowhere to record one. Distinct from
 *                   SYSTEM on purpose: "the system did it" and "we did
 *                   not write down who did it" are different facts and
 *                   only one of them is a gap.
 *   UNKNOWN       — a staff id we could not resolve to a row.
 *
 * Never "undefined", never a blank, never a fabricated person.
 */
import { ActorType } from '@skydrop/db';

export type TrailActorKind =
  | 'STAFF'
  | 'STAFF_REMOVED'
  | 'SYSTEM'
  | 'SELLER'
  | 'STORE'
  | 'STAFF_AS_CLIENT'
  | 'API'
  | 'COURIER'
  | 'UNRECORDED'
  | 'UNKNOWN';

export interface TrailActor {
  readonly kind: TrailActorKind;
  /** The person's display name. Set for STAFF / STAFF_REMOVED only. */
  readonly name: string | null;
}

/** What a staff lookup has to return for this file to do its job. */
export interface StaffNameRow {
  readonly id: string;
  readonly emailDisplay: string;
  readonly email: string;
  readonly deletedAt: Date | null;
}

export const SYSTEM_ACTOR: TrailActor = { kind: 'SYSTEM', name: null };
export const UNRECORDED_ACTOR: TrailActor = { kind: 'UNRECORDED', name: null };

/**
 * `rakib.hasan+wh@skydrop.global` → `Rakib Hasan Wh`.
 *
 * Separators are `.`, `_`, `-` and `+`; each word is capitalised and the
 * rest left alone, so `qa2` stays `Qa2` rather than becoming `Qa 2`.
 * Returns null when there is nothing left to show — the caller then has
 * an UNKNOWN actor rather than an empty row.
 */
export function staffDisplayName(row: { readonly emailDisplay: string; readonly email: string }): {
  readonly name: string | null;
} {
  const source = row.emailDisplay.trim() === '' ? row.email : row.emailDisplay;
  const local = source.split('@')[0] ?? '';
  const words = local
    .split(/[._+-]+/)
    .map((w) => w.trim())
    .filter((w) => w !== '')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return { name: words.length === 0 ? null : words.join(' ') };
}

/** One staff row → an actor. */
export function actorForStaffRow(row: StaffNameRow): TrailActor {
  const { name } = staffDisplayName(row);
  if (name === null) return { kind: 'UNKNOWN', name: null };
  return { kind: row.deletedAt === null ? 'STAFF' : 'STAFF_REMOVED', name };
}

/**
 * A nullable `*_by_staff_id` column → an actor.
 *
 * A null id on a column that EXISTS means the act was not performed by a
 * person (the sweep, a backfill, an automatic transition), which is
 * SYSTEM. A column that does not exist at all never reaches here — its
 * caller passes `UNRECORDED_ACTOR`.
 */
export function actorForStaffId(
  staffId: string | null,
  names: ReadonlyMap<string, StaffNameRow>,
): TrailActor {
  if (staffId === null) return SYSTEM_ACTOR;
  const row = names.get(staffId);
  if (row === undefined) return { kind: 'UNKNOWN', name: null };
  return actorForStaffRow(row);
}

/**
 * An `order_events` / `audit_logs` actor pair → an actor.
 *
 * The append-only tables already record who drove a transition, which is
 * how the steps with no `*_by_staff_id` column of their own (the batch
 * pick, the RTO receive) still have an honest answer — read, never
 * re-recorded.
 */
export function actorForEvent(
  actorType: ActorType | null,
  actorId: string | null,
  names: ReadonlyMap<string, StaffNameRow>,
): TrailActor {
  switch (actorType) {
    case ActorType.STAFF:
      return actorForStaffId(actorId, names);
    case ActorType.SELLER:
      // Deliberately NOT the seller's name: this trail is read by staff
      // across every client, and whose account it was is already on the
      // page. "The client" is the whole fact a warehouse hand needs.
      return { kind: 'SELLER', name: null };
    case ActorType.STORE:
      return { kind: 'STORE', name: null };
    // IMP-5: `actorId` on these rows is the CLIENT's user, not the staff
    // member — the staff id lives on `audit_logs` alone. So the honest
    // answer is "staff, from inside the client's account", with no name
    // this table can supply.
    case ActorType.STAFF_AS_SELLER:
    case ActorType.STAFF_AS_STORE:
      return { kind: 'STAFF_AS_CLIENT', name: null };
    case ActorType.API:
      return { kind: 'API', name: null };
    case ActorType.SYSTEM:
    case null:
      return SYSTEM_ACTOR;
    default:
      return { kind: 'UNKNOWN', name: null };
  }
}
