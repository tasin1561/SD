import { Injectable, ServiceUnavailableException, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { runImpersonated } from './impersonation-context';
import {
  ImpersonationSessionLoader,
  type ImpersonationVerdict,
} from './impersonation-session-loader.service';

/**
 * Opens the ambient impersonation context, and is MIDDLEWARE rather than
 * a guard or an interceptor for one reason that admits no argument.
 *
 * ── WHY NOT A GUARD ─────────────────────────────────────────────────
 * `runImpersonated(ctx, fn)` is `AsyncLocalStorage.run`: the store exists
 * for the duration of `fn` and not one tick longer. A guard's
 * `canActivate` RETURNS before the handler is called, so a context opened
 * inside it is gone by the time anything is audited. The code would look
 * right, every test of the guard would pass, and in production every row
 * would say the seller acted alone — silently, into an append-only table
 * (MUST NOT #3). That is the single worst outcome available in this
 * build, and it is reachable by a one-line mistake.
 *
 * ── WHY NOT AN INTERCEPTOR ──────────────────────────────────────────
 * An interceptor can wrap the handler, but `next.handle()` is a LAZY
 * observable: it is subscribed after `intercept` returns, so
 * `runImpersonated(ctx, () => next.handle())` has the same hole as the
 * guard. It can be made to work by hand-subscribing inside the scope,
 * and it still would not cover the GUARDS — and the seller and store
 * guards write audit rows of their own (`seller.access_denied_status`,
 * `store.access_denied_permission`). Those rows are about a support
 * session being refused; one that claims the seller refused themselves
 * is a lie in the oversight record.
 *
 * Middleware is the only hook that is already INSIDE the call stack of
 * everything that follows: `runImpersonated(ctx, () => next())` puts the
 * guards, the interceptors, the pipes, the handler, the exception filter
 * and even work that outlives the response inside one scope, because
 * express runs the rest of the chain synchronously within `next()` and
 * every async continuation from there inherits the store.
 *
 * ── THE ORDINARY PATH IS UNTOUCHED ──────────────────────────────────
 * No cookie means one `req.cookies` lookup and `next()`. No query, no
 * context, nothing added to the request — `currentImpersonation()` keeps
 * answering null for every real seller, store user, staff member and
 * background job, which is what the rest of the system is built on.
 */
@Injectable()
export class ImpersonationAlsMiddleware implements NestMiddleware {
  constructor(private readonly loader: ImpersonationSessionLoader) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    // Nothing may escape: express ignores the promise this returns, so a
    // rejection here would be an unhandled rejection AND a request that
    // never answers. A session we cannot read is a session we refuse —
    // the one direction a database outage is allowed to push this.
    let verdict: ImpersonationVerdict;
    try {
      verdict = await this.loader.verdictFor(req);
    } catch {
      req.impersonationRejection = new ServiceUnavailableException({
        code: 'IMPERSONATION_SESSION_UNCHECKABLE',
        message:
          'This support session could not be checked just now, so it was refused. Try again.',
      });
      next();
      return;
    }
    if (verdict.kind === 'none') {
      next();
      return;
    }
    if (verdict.kind === 'refused') {
      // Carried, not thrown — see the loader. `ImpersonationGuard` turns
      // it into a 401 with the same body shape as every other refusal.
      // Note that the request continues WITHOUT a context, so even if the
      // guard were somehow skipped the request could only ever be a
      // non-impersonated one, which the JWT guards then refuse for want
      // of a bearer token. Failing closed twice, by two mechanisms.
      req.impersonationRejection = verdict.error;
      next();
      return;
    }
    runImpersonated(verdict.context, () => next());
  }
}
