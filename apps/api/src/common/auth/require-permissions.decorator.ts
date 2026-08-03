import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { PermissionKey } from './permissions';

export const REQUIRE_PERMISSIONS_KEY = 'skydrop:requiredPermissions';
export const STAFF_SELF_SERVICE_KEY = 'skydrop:staffSelfService';

/**
 * What a staff member must hold to reach this endpoint.
 *
 * Works at CLASS level (the controller's default) and at HANDLER level
 * (which overrides it, not adds to it). Most controllers are one domain,
 * so the common shape is a class-level read permission plus a handler
 * override on each write:
 *
 *   @RequirePermissions('orders.view')
 *   @Controller('admin/orders')
 *   export class AdminOrderController {
 *     @Get() list() {}                                    // orders.view
 *
 *     @Post(':id/cancel')
 *     @RequirePermissions('orders.cancel')                // overrides
 *     cancel() {}
 *   }
 *
 * Several keys mean ANY of them — the same "allowed list" semantics
 * `requireStaffRoles` had. If you want two things at once, that is one
 * permission with a name that says so, not an AND that a reader has to
 * evaluate in their head.
 *
 * ── DECLARING NOTHING IS A REFUSAL ───────────────────────────────────
 * An endpoint behind `StaffJwtGuard` with no declaration is REFUSED, not
 * allowed. This is the whole point: before it, 92 of 156 admin handlers
 * carried authentication and no authorisation at all, so a call agent
 * could set the exchange rate that converts every seller's money. A new
 * controller is now invisible until someone decides who it is for.
 */
export function RequirePermissions(...permissions: readonly PermissionKey[]): CustomDecorator {
  return SetMetadata(REQUIRE_PERMISSIONS_KEY, permissions);
}

/**
 * The narrow opt-out: an endpoint every authenticated staff member may
 * reach BECAUSE it is about themselves — reading their own identity,
 * changing their own password, signing out.
 *
 * Deliberately a named decorator rather than an exemption list in the
 * guard, so `grep -rn StaffSelfService` is the complete answer to "what
 * is not permission-gated", and adding to that set is a visible diff.
 */
export function StaffSelfService(): CustomDecorator {
  return SetMetadata(STAFF_SELF_SERVICE_KEY, true);
}
