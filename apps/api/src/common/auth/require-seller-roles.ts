import { ForbiddenException } from '@nestjs/common';
import type { SellerUserRole } from '@skydrop/db';
import type { AuthenticatedSeller } from '../types/request';

/**
 * Inline RBAC gate for seller endpoints (mirrors requireStaffRoles).
 *
 * Phase 1B introduces SellerUser RBAC. The session's `role` is checked
 * against the `allowed` list at the controller layer. OWNER is NOT
 * auto-allowed — include it explicitly when the endpoint should accept
 * the owner (most ops endpoints should).
 *
 * Example:
 *   requireSellerRoles(seller, ['OWNER', 'ADMIN']);
 *   requireSellerRoles(seller, ['OWNER', 'ADMIN', 'FINANCE']);
 */
export function requireSellerRoles(
  seller: AuthenticatedSeller,
  allowed: readonly SellerUserRole[],
): void {
  if (!allowed.includes(seller.role)) {
    throw new ForbiddenException({
      code: 'INSUFFICIENT_ROLE',
      message: `Role ${seller.role} not permitted; required one of: ${allowed.join(', ')}`,
    });
  }
}
