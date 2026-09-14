import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { StorePermissionKey } from './store-permissions';

export const REQUIRE_STORE_PERMISSIONS_KEY = 'skydrop:requiredStorePermissions';
export const STORE_SELF_SERVICE_KEY = 'skydrop:storeSelfService';

/**
 * What a reseller store user must hold to reach this endpoint (RS-2).
 *
 * The seller decorator's twin: CLASS level is the controller's default,
 * HANDLER level OVERRIDES it. Several keys mean ANY of them.
 *
 * DECLARING NOTHING IS A REFUSAL. `StoreJwtGuard` refuses an endpoint
 * with no declaration on reads AND writes — the fail-closed shape RBAC-1
 * gave the seller side — and `store-permission-surface.spec.ts` fails
 * the build before that refusal can reach anybody.
 */
export function RequireStorePermissions(
  ...permissions: readonly StorePermissionKey[]
): CustomDecorator {
  return SetMetadata(REQUIRE_STORE_PERMISSIONS_KEY, permissions);
}

/**
 * The narrow opt-out: an endpoint any signed-in store user may reach
 * BECAUSE it is about themselves — signing in and out, their own
 * password, their own identity. `grep -rn StoreSelfService` is the
 * complete list of what is not permission-gated.
 */
export function StoreSelfService(): CustomDecorator {
  return SetMetadata(STORE_SELF_SERVICE_KEY, true);
}
