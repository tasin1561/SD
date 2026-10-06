import type { Prisma } from '@skydrop/db';

/**
 * The ONE place a person's roles are written, for each of the three
 * identities.
 *
 * ── WHY A HELPER AND NOT FOUR NESTED `create`s ──────────────────────
 * `*_user_roles` is the SOLE authority for authorisation, and there are
 * four paths per identity that create or re-role somebody — exactly the
 * number at which hand-written copies start to disagree. A seller user
 * created with no join rows is not a narrower login: the guard reads
 * zero live roles and answers UNAUTHORIZED, so that person cannot sign
 * in at all. One helper is what keeps every path writing the same shape.
 *
 * ── THE TRANSITIONAL COLUMN IS GONE ─────────────────────────────────
 * `*_users.role_id` and the `role` enums beside it were dropped by
 * `20261006..._drop_transitional_role_columns`. They were written here
 * too, as a label pointing at the first role, for as long as code from
 * before the multi-role deploy might still read them. Nothing does, so
 * there is now one place a role is recorded rather than two that could
 * disagree — the drift CNS-2 and BIN-1 exist to prevent.
 *
 * ── REPLACE, NEVER MERGE ────────────────────────────────────────────
 * `setStaffRoles` and its twins REPLACE the set. "Add a role" and "set
 * the roles" are different operations and only one of them can express
 * taking a role away; a merge-only API means a role can never be
 * removed, which is how somebody keeps an access tier they were moved
 * off.
 */

/** At least one — a person with no roles cannot sign in (see above). */
export const NO_ROLES = 'NO_ROLES';

export const NO_ROLES_MESSAGE =
  'A person must hold at least one role. Somebody with none cannot sign in at all.';

/** Deduped, order preserved — the order the person chose is kept. */
export function normaliseRoleIds(roleIds: readonly string[]): readonly string[] {
  return [...new Set(roleIds)];
}

function requireAtLeastOne(roleIds: readonly string[]): void {
  if (roleIds.length === 0) throw new Error(NO_ROLES_MESSAGE);
}

export async function setStaffRoles(
  tx: Prisma.TransactionClient,
  staffUserId: string,
  roleIds: readonly string[],
): Promise<void> {
  const ids = normaliseRoleIds(roleIds);
  requireAtLeastOne(ids);
  await tx.staffUserRoleAssignment.deleteMany({
    where: { staffUserId, roleId: { notIn: [...ids] } },
  });
  await tx.staffUserRoleAssignment.createMany({
    data: ids.map((roleId) => ({ staffUserId, roleId })),
    skipDuplicates: true,
  });
}

export async function setSellerUserRoles(
  tx: Prisma.TransactionClient,
  sellerUserId: string,
  roleIds: readonly string[],
): Promise<void> {
  const ids = normaliseRoleIds(roleIds);
  requireAtLeastOne(ids);
  await tx.sellerUserRoleAssignment.deleteMany({
    where: { sellerUserId, roleId: { notIn: [...ids] } },
  });
  await tx.sellerUserRoleAssignment.createMany({
    data: ids.map((roleId) => ({ sellerUserId, roleId })),
    skipDuplicates: true,
  });
}

export async function setStoreUserRoles(
  tx: Prisma.TransactionClient,
  storeUserId: string,
  roleIds: readonly string[],
): Promise<void> {
  const ids = normaliseRoleIds(roleIds);
  requireAtLeastOne(ids);
  await tx.storeUserRoleAssignment.deleteMany({
    where: { storeUserId, roleId: { notIn: [...ids] } },
  });
  await tx.storeUserRoleAssignment.createMany({
    data: ids.map((roleId) => ({ storeUserId, roleId })),
    skipDuplicates: true,
  });
}

/**
 * The `data` fragment that gives a brand-new user their roles.
 *
 * One write, so a user row can never exist without its join rows — and
 * a user with no join rows cannot sign in (see above), which makes that
 * the difference between a narrower login and a broken one.
 */
export function rolesOnCreate(roleIds: readonly string[]): {
  roles: { create: { roleId: string }[] };
} {
  const ids = normaliseRoleIds(roleIds);
  requireAtLeastOne(ids);
  return { roles: { create: ids.map((roleId) => ({ roleId })) } };
}
