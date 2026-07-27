import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
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
