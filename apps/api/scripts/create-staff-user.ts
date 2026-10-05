/**
 * Dev helper: create or replace a staff user with the given role + password.
 *
 *   pnpm tsx scripts/create-staff-user.ts <email> <password> <role>
 *
 * <role> is one of:
 *   SUPER_ADMIN | SELLER_APPROVAL_ADMIN | CALL_AGENT | WAREHOUSE_STAFF
 *   MANUAL_PLACEMENT_ADMIN | FINANCE
 *
 * Useful before the staff-onboarding module lands. Idempotent — upserts by
 * email and resets the password hash + role on every run.
 */
import argon2 from 'argon2';
import { prisma, StaffRole } from '@skydrop/db';
import { staffRoleKeyForEnum } from '../src/common/auth/staff-role-key';
import { rolesOnCreate, setStaffRoles } from '../src/common/auth/role-assignment';

async function main(): Promise<void> {
  const [, , emailArg, passwordArg, roleArg] = process.argv;
  if (!emailArg || !passwordArg || !roleArg) {
    console.error('Usage: pnpm tsx scripts/create-staff-user.ts <email> <password> <role>');
    process.exit(1);
  }
  if (!(roleArg in StaffRole)) {
    console.error(`Invalid role: ${roleArg}. Allowed: ${Object.keys(StaffRole).join(', ')}`);
    process.exit(1);
  }
  const role = StaffRole[roleArg as keyof typeof StaffRole];
  const email = emailArg.trim().toLowerCase();

  const passwordHash = await argon2.hash(passwordArg, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const roleRow = await prisma.staffRoleDefinition.findFirstOrThrow({
    where: { key: staffRoleKeyForEnum(role), deletedAt: null },
    select: { id: true },
  });

  const staff = await prisma.staffUser.upsert({
    where: { email },
    create: {
      email,
      emailDisplay: emailArg,
      passwordHash,
      role,
      // The JOIN ROW, not just `role_id` — a staff row without one
      // cannot sign in at all, because the guard reads zero live roles.
      ...rolesOnCreate([roleRow.id]),
    },
    update: { emailDisplay: emailArg, passwordHash, role },
    select: { id: true, email: true, role: true },
  });
  // The upsert's UPDATE branch cannot write the join row (it has no id
  // to key on until the row exists), so the roles are set after.
  await setStaffRoles(prisma, staff.id, [roleRow.id]);

  console.info(`staff user ready: ${staff.email} (id=${staff.id}, role=${staff.role})`);
  await prisma.$disconnect();
}

void main();
