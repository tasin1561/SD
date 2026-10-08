/**
 * What a person holding SEVERAL roles may do.
 *
 * ── THE UNION, AND WHY IT IS A UNION ────────────────────────────────
 * Roles are additive by construction: a permission row's ABSENCE is the
 * denial and there is no deny-list (see `permissions.ts`), precisely so
 * that nothing has to be resolved by a precedence rule nobody
 * remembers. The moment a person can hold two of them, the only answer
 * consistent with that is the union — anything else would be a
 * deny-list arriving by the back door, and the back door is where the
 * precedence problem comes in.
 *
 * ── SUPERUSER IS ANY-SEMANTICS ──────────────────────────────────────
 * A superuser role (staff `is_super_admin`, seller/store `is_owner`)
 * carries NO permission rows at all — it grants the whole catalogue
 * implicitly, including keys a later release adds. So holding one
 * ALONGSIDE a narrower role must still grant everything; taking the
 * union of rows would have silently demoted them to the narrow role,
 * which is the worst kind of failure here because it looks like working
 * software with some buttons missing.
 *
 * ── ZERO ROLES IS NOT "ZERO PERMISSIONS, CARRY ON" ──────────────────
 * It is a person whose every role was deleted under them, and the
 * guards answer UNAUTHORIZED — "sign in again" — exactly as they did
 * when there was one role to lose. `hasNoLiveRoles` is the test, so the
 * three guards cannot come to disagree about it; letting such a session
 * through with an empty grant set would reach every self-service
 * endpoint while reading as a working login.
 */

export interface HeldRole {
  /** Grants the whole catalogue implicitly, now and in future releases. */
  readonly superuser: boolean;
  /** This role's own granted keys. Empty for a superuser role. */
  readonly permissions: readonly string[];
}

/**
 * The permissions a set of roles grants between them.
 *
 * `allKeys` is the catalogue that a superuser role resolves to — the
 * caller passes its own identity's catalogue, which is what keeps one
 * function serving staff, sellers and stores without any of them
 * learning about the others' keys.
 */
export function unionPermissions<K extends string>(
  roles: readonly HeldRole[],
  allKeys: readonly K[],
): readonly string[] {
  if (roles.some((r) => r.superuser)) return allKeys;
  const held = new Set<string>();
  for (const role of roles) {
    for (const key of role.permissions) held.add(key);
  }
  return [...held];
}

/** True when nothing is left to reason about — see the note above. */
export function hasNoLiveRoles(roles: readonly HeldRole[]): boolean {
  return roles.length === 0;
}

/**
 * The shape the guards and the `/me` handlers read a person's roles in.
 *
 * `deletedAt` is carried so the LIVE filter happens in one place: a
 * soft-deleted role is not a role, and a guard that selects the rows
 * and forgets the filter grants permissions from a role an admin
 * deleted this morning.
 */
export interface RoleAssignmentRow {
  readonly role: {
    readonly key: string;
    readonly name: string;
    readonly deletedAt: Date | null;
    readonly permissions: readonly { readonly permission: string }[];
  } & ({ readonly isSuperAdmin: boolean } | { readonly isOwner: boolean });
}

function isSuperuser(role: { isSuperAdmin?: boolean; isOwner?: boolean }): boolean {
  return role.isSuperAdmin === true || role.isOwner === true;
}

export interface ResolvedRoles<R> {
  /** Live roles only, in the order they came back. */
  readonly roles: readonly { readonly key: string; readonly name: string }[];
  /**
   * The same live roles as the caller SELECTED them, so an identity can
   * read its own extra columns off a role without filtering `deletedAt`
   * for itself. The store's `order_scope` (ASSOC-1) is the first such
   * column: resolving it from the raw assignments would mean a second
   * copy of the live filter, and a guard whose permissions and whose
   * scope disagree about which roles count is the exact bug this file's
   * docblock exists to prevent.
   */
  readonly live: readonly R[];
  readonly permissions: readonly string[];
  /**
   * One role for a message, an audit row and the legacy single-role
   * fields the request object still carries. The FIRST live role, which
   * is deterministic because the caller orders the rows; it is a label,
   * never an authorisation input.
   */
  readonly primary: { readonly key: string; readonly name: string } | null;
}

/**
 * Resolve the join-table rows a guard loaded into what it needs.
 *
 * Returns `permissions: []` and `primary: null` for somebody whose every
 * role is gone; the caller tests `roles.length === 0` and answers
 * UNAUTHORIZED rather than carrying on with nothing.
 */
export function resolveRoles<K extends string, R extends RoleAssignmentRow['role']>(
  assignments: readonly { readonly role: R }[],
  allKeys: readonly K[],
): ResolvedRoles<R> {
  const live = assignments.map((a) => a.role).filter((r) => r.deletedAt === null);
  const permissions = unionPermissions(
    live.map((r) => ({
      superuser: isSuperuser(r as { isSuperAdmin?: boolean; isOwner?: boolean }),
      permissions: r.permissions.map((p) => p.permission),
    })),
    allKeys,
  );
  const roles = live.map((r) => ({ key: r.key, name: r.name }));
  return { roles, live, permissions, primary: roles[0] ?? null };
}

/** "Call agent and Support" — for a refusal message a person reads. */
export function roleNamesFor(roles: readonly { readonly name: string }[]): string {
  if (roles.length === 0) return 'Nobody';
  if (roles.length === 1) return roles[0]?.name ?? 'Nobody';
  const last = roles[roles.length - 1]?.name ?? '';
  return `${roles
    .slice(0, -1)
    .map((r) => r.name)
    .join(', ')} and ${last}`;
}
