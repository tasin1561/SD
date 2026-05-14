import { SetMetadata } from '@nestjs/common';

export const THROTTLE_KEY_STRATEGY = 'throttle:key-strategy';

/**
 * Key strategies for the custom AppThrottlerGuard:
 *
 *   - email-ip:  rate-limit by (lowercased body.email, request IP). Used for
 *                login flows so a single attacker IP can't burn through every
 *                account, and a single account can't be locked from one IP
 *                by traffic from another.
 *   - email:     rate-limit by lowercased body.email alone. Used for
 *                password-reset request: a user who fat-fingers their email
 *                across networks should still hit the same bucket.
 *   - ip:        rate-limit by request IP. Used for endpoints that don't
 *                have a stable per-actor identifier (e.g., invitation consume).
 *   - auth-user: rate-limit by req.staff.id / req.seller.id. Used as the
 *                default on all authenticated endpoints.
 */
export type ThrottleKeyStrategy = 'email-ip' | 'email' | 'ip' | 'auth-user';

export const ThrottleKey = (strategy: ThrottleKeyStrategy): MethodDecorator & ClassDecorator =>
  SetMetadata(THROTTLE_KEY_STRATEGY, strategy);
