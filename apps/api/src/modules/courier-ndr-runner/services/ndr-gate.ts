import type { NdrAction } from '../../courier-delhivery/services/delhivery-ndr.service';

/**
 * Delhivery's own vocabulary — the only two actions the API accepts.
 *
 * Exported because two other places need the same list and must not keep
 * their own copy: `NdrSettingsService` drops anything unrecognised out of
 * a stored list, and SET-1's override writer refuses a seller override
 * that names something else. `ndr-seller-gate.spec.ts` pins the
 * resolver's copy against this one.
 */
export const KNOWN_NDR_ACTIONS: readonly NdrAction[] = ['RE-ATTEMPT', 'PICKUP_RESCHEDULE'];

/** What the runner is permitted to do — globally, or for one seller. */
export interface NdrGate {
  /** The kill switch. */
  readonly enabled: boolean;
  /** Which actions may be fired unattended. */
  readonly autoActions: readonly NdrAction[];
}

/**
 * A seller's overrides, where `null` means "this seller set nothing".
 *
 * Deliberately NOT the same shape as `NdrGate`: an absent override and
 * an override of `[]` are different facts, and collapsing them would
 * make "no opinion" indistinguishable from "nothing at all".
 */
export interface NdrSellerNarrowing {
  readonly enabled: boolean | null;
  readonly autoActions: readonly NdrAction[] | null;
}

/** The seller has expressed no preference: the global gate stands. */
export const NO_NARROWING: NdrSellerNarrowing = { enabled: null, autoActions: null };

/**
 * The fail-closed answer. A settings read that errors must mean "do
 * nothing for this seller", never "fall back to the global", because the
 * global is the permissive end of this relationship.
 */
export const NARROW_TO_NOTHING: NdrSellerNarrowing = { enabled: false, autoActions: [] };

/**
 * THE ONE PLACE A PER-SELLER NDR SWITCH IS APPLIED. It NARROWS. It can
 * never widen, and that is not a convention — it is the arithmetic.
 *
 * ── WHY ONE-DIRECTIONAL ──────────────────────────────────────────────
 * An NDR re-attempt dispatches a real van, at real cost, against a real
 * customer's address, and there is no sandbox to try it in. The global
 * switches are therefore an operator's deliberate "no": `enabled` off
 * means nobody's parcels are touched tonight, and a category absent from
 * `courier.ndr_auto_categories` means that action has never been let out
 * of the building. CUR-10 as amended (2026-08-05) permits this runner to
 * exist AT ALL only because those two gates are reliable.
 *
 * A per-seller setting resolved the ordinary SET-1 way —
 * `sellerOverride ?? globalDefault` — would make them unreliable: one
 * seller row saying `true` would fire vans on a night an operator had
 * switched the runner off, and a seller list naming `PICKUP_RESCHEDULE`
 * would send an action the global list has never permitted. The failure
 * is expensive and physical, and it is discovered by a courier turning
 * up rather than by anything in this system.
 *
 * So:
 *   • `enabled`      — AND, never `??`. Off globally ⇒ off for everyone.
 *   • `autoActions`  — INTERSECTION, never union. The global list is the
 *                      CEILING; a seller can only take things out of it.
 *
 * **Do not reimplement this as `sellerValue ?? globalValue` at a call
 * site.** That shape is right for every other seller-overridable key and
 * wrong for exactly these two, which is precisely why the narrowing is a
 * named function with one caller rather than two lines of inline `??`.
 *
 * Pure: no Prisma, no DI, no settings reads. It takes two answers and
 * returns the one that holds — the same discipline as
 * `CallOutcomeMappingService` and `CourierOptionSelectionService`.
 */
export function narrowNdrGate(global: NdrGate, seller: NdrSellerNarrowing): NdrGate {
  const sellerActions = seller.autoActions;
  return {
    // AND. `?? true` is the "seller said nothing" case, and it still
    // cannot widen: `global.enabled && true` is `global.enabled`.
    enabled: global.enabled && (seller.enabled ?? true),
    // INTERSECTION, driven from the GLOBAL list so an entry a seller
    // names that the global does not carry simply falls out.
    autoActions:
      sellerActions === null
        ? global.autoActions
        : global.autoActions.filter((a) => sellerActions.includes(a)),
  };
}

/**
 * Read a stored JSON value as a list of NDR actions.
 *
 * Anything unrecognised is DROPPED rather than trusted: these lists are
 * edited by hand in an admin form, and a typo must not become an action
 * nobody reviewed. SET-1's writer now refuses one at the door
 * (`JSON_VALUED_ENUM_LIST_KEYS`), so this is the second line — it also
 * covers rows written before that check existed.
 */
export function parseNdrActions(raw: unknown): NdrAction[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (v): v is NdrAction =>
      typeof v === 'string' && (KNOWN_NDR_ACTIONS as readonly string[]).includes(v),
  );
}
