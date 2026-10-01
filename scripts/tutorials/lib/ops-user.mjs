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
 * RBAC is a ROW, not only the legacy `role` enum: a staff user without a
 * `staffRole` cannot be created at all, and one created with the enum
 * alone would hold no permissions.
 */
export async function ensureOpsStaff() {
  const passwordHash = await hashPassword(OPS.password);
  const superAdmin = await prisma.staffRoleDefinition.findFirstOrThrow({
    where: { key: 'super_admin' },
    select: { id: true },
  });
  await prisma.staffUser.upsert({
    where: { email: OPS.email },
    update: {
      passwordHash,
      role: 'SUPER_ADMIN',
      staffRole: { connect: { id: superAdmin.id } },
      deletedAt: null,
    },
    create: {
      email: OPS.email,
      emailDisplay: OPS.email,
      passwordHash,
      role: 'SUPER_ADMIN',
      staffRole: { connect: { id: superAdmin.id } },
    },
  });
  const login = await call('/auth/staff/login', { method: 'POST', body: OPS });
  return login.accessToken;
}
