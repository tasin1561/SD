import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { SellerPermissionKey } from './seller-permissions';

export const REQUIRE_SELLER_PERMISSIONS_KEY = 'skydrop:requiredSellerPermissions';
export const SELLER_SELF_SERVICE_KEY = 'skydrop:sellerSelfService';

/**
 * What a member of the seller's team must hold to reach this endpoint.
 *
 * Works at CLASS level (the controller's default) and HANDLER level
 * (which OVERRIDES it, not adds to it) — so the common shape is a
 * class-level read permission plus an override on each write:
 *
 *   @RequireSellerPermissions('orders.view')
 *   @Controller('seller/orders')
 *   export class SellerOrderController {
 *     @Get() list() {}                                   // orders.view
 *
 *     @Post()
 *     @RequireSellerPermissions('orders.create')          // overrides
 *     create() {}
 *   }
 *
 * Several keys mean ANY of them. If you want two things at once, that is
 * one permission with a name that says so.
 *
 * ── DECLARING NOTHING IS A REFUSAL ───────────────────────────────────
 * An endpoint behind `SellerJwtGuard` with no declaration is REFUSED.
 * The role system it replaces was fail-closed on WRITES only: reads
 * stayed open to five of the six roles, so "may not change the wallet"
 * and "may not see the wallet" could not be told apart. Now they can,
 * and the default is closed on both.
 */
export function RequireSellerPermissions(
  ...permissions: readonly SellerPermissionKey[]
): CustomDecorator {
  return SetMetadata(REQUIRE_SELLER_PERMISSIONS_KEY, permissions);
}

/**
 * The narrow opt-out: an endpoint any authenticated team member may
 * reach BECAUSE it is about themselves — their own identity, their own
 * password, signing out.
 *
 * A named decorator rather than a list inside the guard, so
 * `grep -rn SellerSelfService` is the complete answer to "what is not
 * permission-gated".
 */
export function SellerSelfService(): CustomDecorator {
  return SetMetadata(SELLER_SELF_SERVICE_KEY, true);
}
