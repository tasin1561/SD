/**
 * The ops staff account the recording rig signs in as, in ONE place.
 *
 * `seed-demo-data.mjs` created it and `provision-stack.mjs` needs it
 * too — a fresh stack has no staff user, and nothing can be provisioned
 * through the admin API without one. Two copies of this upsert would be
 * two answers to "what password does tutorial-ops have", and the second
 * one to run would win silently.
 *
 * SUPER_ADMIN because goods receipts are received by ops rather than by
 * the seller, and because the provisioner creates courier accounts and
 * bank accounts, which carry their own dangerous permissions.
 */
import { prisma, argon2 } from './deps.mjs';
import { call } from './api.mjs';

/** Kept in step with `record.mjs`'s `APPS.admin.identity` and `peek.mjs`. */
export const OPS = Object.freeze({
  email: process.env.TUTORIAL_OPS_EMAIL ?? 'tutorial-ops@skydrop.local',
  password: process.env.TUTORIAL_OPS_PASSWORD ?? 'Tutorial-Ops-2026',
});

/** OWASP-parameter argon2id, the same shape the API hashes with. */
export function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

/**
 * Upsert the ops staff user and return a staff access token.
 *
 * The password is FORCE-SET on every run so a re-seed always
 * authenticates — a tutorial rig that cannot sign in because somebody
 * changed a password by hand is a re-take lost to nothing.
 *
 * RBAC is a ROW, never a field on the person. RBAC-1b (2026-10-05)
 * replaced the single `role_id` with the `staff_user_roles` JOIN TABLE,
 * so somebody holds SEVERAL roles and their permissions are the union.
 *
 * This function wrote `role: 'SUPER_ADMIN'` and `staffRole: { connect }`
 * until 2026-10-08, and the follow-up migration that dropped both left
 * it writing two fields `StaffUser` no longer has — so `main()` threw on
 * its FIRST call and **every tutorial in the library became unfilmable**,
 * not only the new ones. Nobody met it because nothing had been filmed
 * since; it was found while seeding the long videos.
 *
 * The role rows are written as their own upsert rather than a nested
 * `create`, because a nested create on a re-seed collides with the row
 * already there — and a seed that works once is the thing this whole
 * file exists to avoid.
 */
export async function ensureOpsStaff() {
  const passwordHash = await hashPassword(OPS.password);
  const superAdmin = await prisma.staffRoleDefinition.findFirstOrThrow({
    where: { key: 'super_admin' },
    select: { id: true },
  });
  const staff = await prisma.staffUser.upsert({
    where: { email: OPS.email },
    update: { passwordHash, deletedAt: null },
    create: {
      email: OPS.email,
      emailDisplay: OPS.email,
      passwordHash,
    },
    select: { id: true },
  });
  // Idempotent: the compound primary key is (staffUserId, roleId), so a
  // re-seed finds the row rather than duplicating or throwing.
  await prisma.staffUserRoleAssignment.upsert({
    where: { staffUserId_roleId: { staffUserId: staff.id, roleId: superAdmin.id } },
    update: {},
    create: { staffUserId: staff.id, roleId: superAdmin.id },
  });
  const login = await call('/auth/staff/login', { method: 'POST', body: OPS });
  return login.accessToken;
}
