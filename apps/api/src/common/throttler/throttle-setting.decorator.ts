import { SetMetadata } from '@nestjs/common';

export const THROTTLE_SETTING_KEY = 'throttle:setting-key';

/**
 * Take this route's per-window limit from a `system_settings` row
 * instead of the number baked into `@Throttle()`.
 *
 * ── WHY THE STATIC NUMBER STAYS ──────────────────────────────────────
 * `@Throttle()` is still required alongside this and is still the
 * FALLBACK. A settings read that fails — row deleted, wrong type,
 * database briefly unreachable — must not remove the rate limit, and
 * "no limit" is precisely the wrong direction to fail on the one
 * endpoint that is open to the internet. So the decorator's number is
 * what applies until a valid row says otherwise.
 */
export const ThrottleSetting = (settingKey: string): MethodDecorator & ClassDecorator =>
  SetMetadata(THROTTLE_SETTING_KEY, settingKey);
