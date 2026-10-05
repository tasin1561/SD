import type { Prisma } from '@skydrop/db';

/**
 * The ONE place a person's roles are written, for each of the three
 * identities.
 *
 * ── WHY A HELPER AND NOT FOUR NESTED `create`s ──────────────────────
 * `*_user_roles` is the AUTHORITY for authorisation and `*_users.role_id`
 * is transitional (see `20261005000000_multi_role_per_person`). Both have
 * to be written, in step, by every path that creates or re-roles
 * somebody — and there are four such paths per identity, which is
 * exactly the number at which they start to disagree. A seller user
 * created with a `role_id` and no join rows is not a narrower login: the
 * guard reads zero live roles and answers UNAUTHORIZED, so that person
 * cannot sign in at all.
 *
 * ── THE LEGACY COLUMN IS THE FIRST ROLE, AND IT IS A LABEL ──────────
 * `role_id` is kept non-null and truthful by pointing it at the first
 * role in the list. It is NOT consulted for authorisation anywhere any
 * more; a follow-up migration drops it. Which one decides is stated
 * rather than left to be inferred, because a column two things disagree
 * about is the drift CNS-2 and BIN-1 exist to prevent.
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

/** Deduped, order preserved — the first entry becomes the legacy label. */
export function normaliseRoleIds(roleIds: readonly string[]): readonly string[] {
  return [...new Set(roleIds)];
}

function firstOrThrow(roleIds: readonly string[]): string {
  const first = roleIds[0];
  if (first === undefined) throw new Error(NO_ROLES_MESSAGE);
  return first;
}

export async function setStaffRoles(
  tx: Prisma.TransactionClient,
  staffUserId: string,
  roleIds: readonly string[],
): Promise<void> {
  const ids = normaliseRoleIds(roleIds);
  const primary = firstOrThrow(ids);
  await tx.staffUserRoleAssignment.deleteMany({
    where: { staffUserId, roleId: { notIn: [...ids] } },
  });
  await tx.staffUserRoleAssignment.createMany({
    data: ids.map((roleId) => ({ staffUserId, roleId })),
    skipDuplicates: true,
  });
  await tx.staffUser.update({ where: { id: staffUserId }, data: { roleId: primary } });
}

export async function setSellerUserRoles(
  tx: Prisma.TransactionClient,
  sellerUserId: string,
  roleIds: readonly string[],
): Promise<void> {
  const ids = normaliseRoleIds(roleIds);
  const primary = firstOrThrow(ids);
  await tx.sellerUserRoleAssignment.deleteMany({
    where: { sellerUserId, roleId: { notIn: [...ids] } },
  });
  await tx.sellerUserRoleAssignment.createMany({
    data: ids.map((roleId) => ({ sellerUserId, roleId })),
    skipDuplicates: true,
  });
  await tx.sellerUser.update({ where: { id: sellerUserId }, data: { roleId: primary } });
}

export async function setStoreUserRoles(
  tx: Prisma.TransactionClient,
  storeUserId: string,
  roleIds: readonly string[],
): Promise<void> {
  const ids = normaliseRoleIds(roleIds);
  const primary = firstOrThrow(ids);
  await tx.storeUserRoleAssignment.deleteMany({
    where: { storeUserId, roleId: { notIn: [...ids] } },
  });
  await tx.storeUserRoleAssignment.createMany({
    data: ids.map((roleId) => ({ storeUserId, roleId })),
    skipDuplicates: true,
  });
  await tx.storeUser.update({ where: { id: storeUserId }, data: { roleId: primary } });
}

/**
 * The `data` fragment that gives a brand-new user their roles.
 *
 * One write, so a user row can never exist without its join rows — and
 * a user with no join rows cannot sign in (see above), which makes that
 * the difference between a narrower login and a broken one.
 */
export function rolesOnCreate(roleIds: readonly string[]): {
  roleId: string;
  roles: { create: { roleId: string }[] };
} {
  const ids = normaliseRoleIds(roleIds);
  return {
    roleId: firstOrThrow(ids),
    roles: { create: ids.map((roleId) => ({ roleId })) },
  };
}
