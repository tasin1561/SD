import { SetMetadata } from '@nestjs/common';

export const SELLER_AUTH_ALLOW_SUSPENDED_KEY = 'sellerAuthAllowSuspended';

/**
 * Marks a route as accessible to SUSPENDED sellers in addition to APPROVED.
 *
 * Read-only endpoints (profile, addresses list, notification preferences
 * view) opt in via this decorator so suspended sellers retain visibility
 * into their own account. Write endpoints stay APPROVED-only by default.
 *
 * PENDING and REJECTED are still rejected even when this decorator is
 * present — those states represent accounts that have never been
 * activated, not paused active accounts.
 */
export const SellerAuthAllowSuspended = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SELLER_AUTH_ALLOW_SUSPENDED_KEY, true);
