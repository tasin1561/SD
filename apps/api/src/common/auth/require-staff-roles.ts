import { ForbiddenException } from '@nestjs/common';
import type { StaffRole } from '@skydrop/db';
import type { AuthenticatedStaff } from '../types/request';

/**
 * Inline role gate for staff endpoints. Phase 1A's RBAC posture: staff
 * JWT is enforced by `StaffJwtGuard`; ROLE scoping is enforced per
 * endpoint by this helper at the controller layer (the broader
 * decorator/metadata-driven RBAC roll-out is the Module 12 admin
 * dashboard concern). SUPER_ADMIN is NOT auto-allowed — include it
 * explicitly when the endpoint should accept it (most ops endpoints
 * should; surface the intent at the call site).
 *
 * Example:
 *   requireStaffRoles(staff, [StaffRole.WAREHOUSE_SUPERVISOR, StaffRole.SUPER_ADMIN]);
 */
export function requireStaffRoles(staff: AuthenticatedStaff, allowed: readonly StaffRole[]): void {
  if (!allowed.includes(staff.role)) {
    throw new ForbiddenException({
      code: 'INSUFFICIENT_ROLE',
      message: `Role ${staff.role} not permitted; required one of: ${allowed.join(', ')}`,
    });
  }
}
