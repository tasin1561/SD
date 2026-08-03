import type { StaffRole } from '@skydrop/db';

/**
 * The `staff_roles.key` for a legacy `StaffRole` enum value.
 *
 * The seven seeded roles deliberately took the enum's own spelling as
 * their key, so this is a lowercase, not a lookup table that could
 * disagree with the migration that wrote them.
 *
 * TRANSITIONAL. It exists so the places that still create a staff user
 * from an enum value can point at the right row; when the enum column
 * goes, so does this, and callers will carry a role id instead.
 */
export function staffRoleKeyForEnum(role: StaffRole): string {
  return role.toLowerCase();
}
