import { Inject, Injectable, Optional, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';
import { ThrottleLimitCacheService } from './throttle-limit-cache.service';
import { THROTTLE_SETTING_KEY } from './throttle-setting.decorator';
import { THROTTLE_KEY_STRATEGY, type ThrottleKeyStrategy } from './throttle-key.decorator';

/**
 * Extends the default ThrottlerGuard to choose the tracking key per route
 * based on @ThrottleKey() metadata. The base guard resolves the per-route
 * limit/ttl from @Throttle() metadata; we only override the key.
 *
 * Implementation note: getTracker() in @nestjs/throttler 6.x takes only the
 * request, not the ExecutionContext. We stash the resolved strategy on the
 * request inside getRequestResponse() (which DOES receive the context),
 * then read it back in getTracker().
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  /**
   * Optional on purpose: the throttler module is global and boots before
   * most feature modules, and a guard that cannot start because a
   * settings cache is not ready yet would take the whole app with it.
   * Absent simply means every route keeps its static limit.
   */
  @Optional()
  @Inject(ThrottleLimitCacheService)
  private readonly limitCache?: ThrottleLimitCacheService;

  /**
   * Let a route take its limit from `system_settings` (@ThrottleSetting).
   *
   * The static number from `@Throttle()` is the FALLBACK, not a default
   * that gets replaced — a settings read that fails must never remove a
   * rate limit from an endpoint open to the internet. The lookup is
   * memoised for a minute (see ThrottleLimitCacheService), so this costs
   * at most one query per minute per instance rather than one per
   * request, which is what made a dynamic limit a worse attack surface
   * than a constant.
   */
  protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const settingKey = this.reflector.getAllAndOverride<string | undefined>(THROTTLE_SETTING_KEY, [
      requestProps.context.getHandler(),
      requestProps.context.getClass(),
    ]);
    if (settingKey === undefined || this.limitCache === undefined) {
      return super.handleRequest(requestProps);
    }
    const configured = await this.limitCache.limitFor(settingKey);
    if (configured === null) return super.handleRequest(requestProps);
    return super.handleRequest({ ...requestProps, limit: configured });
  }

  protected override getRequestResponse(context: ExecutionContext) {
    const pair = super.getRequestResponse(context);
    const strategy = this.reflector.getAllAndOverride<ThrottleKeyStrategy | undefined>(
      THROTTLE_KEY_STRATEGY,
      [context.getHandler(), context.getClass()],
    );
    (pair.req as Record<string, unknown>)['__throttleStrategy'] = strategy ?? null;
    return pair;
  }

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const strategy = req['__throttleStrategy'] as ThrottleKeyStrategy | null;
    const ip = (req['ip'] as string | undefined) ?? 'unknown';
    const body = (req['body'] as Record<string, unknown> | undefined) ?? {};
    const staff = req['staff'] as { id?: string } | undefined;
    const seller = req['seller'] as { id?: string } | undefined;
    const apiKey = req['apiKey'] as { id?: string } | undefined;

    if (!strategy) return `ip:${ip}`;

    switch (strategy) {
      case 'email-ip': {
        const email =
          typeof body['email'] === 'string' ? body['email'].toLowerCase().trim() : 'no-email';
        return `email-ip:${email}:${ip}`;
      }
      case 'email': {
        const email =
          typeof body['email'] === 'string' ? body['email'].toLowerCase().trim() : 'no-email';
        return `email:${email}`;
      }
      case 'ip':
        return `ip:${ip}`;
      case 'auth-user': {
        const id = staff?.id ?? seller?.id ?? apiKey?.id ?? `ip-${ip}`;
        return `user:${id}`;
      }
    }
  }
}
