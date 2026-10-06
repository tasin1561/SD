/**
 * Dev helper: create or replace a staff user with the given role + password.
 *
 *   pnpm tsx scripts/create-staff-user.ts <email> <password> <role>
 *
 * <role> is the NAME of a seeded role — one of:
 *   SUPER_ADMIN | SELLER_APPROVAL_ADMIN | CALL_AGENT | WAREHOUSE_STAFF
 *   WAREHOUSE_SUPERVISOR | MANUAL_PLACEMENT_ADMIN | FINANCE | ADMIN
 *   SUPPORT | READONLY
 *
 * Useful before the staff-onboarding module lands. Idempotent — upserts by
 * email and resets the password hash + roles on every run. It gives the
 * person exactly the ONE named role; `staff_user_roles` is the authority,
 * so this replaces whatever they held rather than adding to it.
 */
import argon2 from 'argon2';
import { prisma, StaffRoleKey } from '@skydrop/db';
import { rolesOnCreate, setStaffRoles } from '../src/common/auth/role-assignment';

async function main(): Promise<void> {
  const [, , emailArg, passwordArg, roleArg] = process.argv;
  if (!emailArg || !passwordArg || !roleArg) {
    console.error('Usage: pnpm tsx scripts/create-staff-user.ts <email> <password> <role>');
    process.exit(1);
  }
  // Argued by NAME (SUPER_ADMIN) so the command line stays what it was,
  // but what reaches the database is the seeded role's `key`.
  if (!(roleArg in StaffRoleKey)) {
    console.error(`Invalid role: ${roleArg}. Allowed: ${Object.keys(StaffRoleKey).join(', ')}`);
    process.exit(1);
  }
  const roleKey = StaffRoleKey[roleArg as keyof typeof StaffRoleKey];
  const email = emailArg.trim().toLowerCase();

  const passwordHash = await argon2.hash(passwordArg, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const roleRow = await prisma.staffRoleDefinition.findFirstOrThrow({
    where: { key: roleKey, deletedAt: null },
    select: { id: true },
  });

  const staff = await prisma.staffUser.upsert({
    where: { email },
    create: {
      email,
      emailDisplay: emailArg,
      passwordHash,
      // The JOIN ROW is the whole of it — a staff row without one cannot
      // sign in at all, because the guard reads zero live roles.
      ...rolesOnCreate([roleRow.id]),
    },
    update: { emailDisplay: emailArg, passwordHash },
    select: { id: true, email: true },
  });
  // The upsert's UPDATE branch cannot write the join row (it has no id
  // to key on until the row exists), so the roles are set after.
  await setStaffRoles(prisma, staff.id, [roleRow.id]);

  console.info(`staff user ready: ${staff.email} (id=${staff.id}, role=${roleKey})`);
  await prisma.$disconnect();
}

void main();
