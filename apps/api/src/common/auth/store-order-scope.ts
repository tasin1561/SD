import { StoreOrderScope } from '@skydrop/db';

/**
 * ASSOC-1 — how much of a reseller store's work one signed-in person sees.
 *
 * ── WHY THIS IS A FUNCTION AND NOT A COMPARISON AT THE CALL SITE ─────
 * Every screen an associate reaches asks the same question — "theirs, or
 * the store's?" — and the tempting shape is `roleKeys.includes('associate')`
 * written out at each one. Two things go wrong with that. A person holds
 * SEVERAL roles since RBAC-1b, so somebody who is both an Associate and
 * an Ops would be narrowed by a role that was only ever meant to grant
 * MORE; and the day a second narrow role exists, every one of those call
 * sites is a place that has not heard of it. Scope is read off the ROLE
 * ROW (`store_roles.order_scope`), resolved here, and applied in a WHERE
 * clause — the `BinPolicyService` / `WarehouseResolverService` discipline.
 *
 * ── WIDEST WINS, AND THAT IS THE WHOLE RULE ──────────────────────────
 * Adding a role must never take something away (RBAC-1b's ANY-semantics
 * for `isOwner`, in the other direction). So ALL beside OWN is ALL. An
 * OWNER role is ALL whatever its column says — it holds the catalogue
 * implicitly, and a scope narrower than its permissions would be a second
 * authorisation model disagreeing with the first.
 *
 * ── NO ROLES IS NOT "SEE EVERYTHING" ─────────────────────────────────
 * An empty list answers OWN. The guard already refuses a session with no
 * live roles, so this cannot be reached through it — but a helper whose
 * empty case is the WIDEST answer is one refactor away from being the
 * bug, and the cost of the other choice is nothing.
 */
export function storeOrderScope(
  roles: ReadonlyArray<{ readonly isOwner: boolean; readonly orderScope: StoreOrderScope }>,
): StoreOrderScope {
  for (const role of roles) {
    if (role.isOwner || role.orderScope === StoreOrderScope.ALL) return StoreOrderScope.ALL;
  }
  return StoreOrderScope.OWN;
}

/**
 * The `where` fragment that narrows a store's orders to one person's.
 *
 * Returned as an object to spread so a caller cannot accidentally write
 * `placedByStoreUserId: undefined` and widen the query to the store —
 * `{}` adds no condition, `undefined` on a Prisma filter also adds none,
 * and the difference is invisible at the call site until somebody passes
 * a variable that is null.
 */
export function storeOrderOwnerFilter(input: {
  readonly scope: StoreOrderScope;
  readonly storeUserId: string;
}): { placedByStoreUserId?: string } {
  return input.scope === StoreOrderScope.OWN ? { placedByStoreUserId: input.storeUserId } : {};
}
