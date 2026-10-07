import { HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { EnvService } from '../../config/env.service';
import {
  ImpersonationService,
  type ImpersonationClaim,
} from '../../modules/impersonation/services/impersonation.service';
import type { ImpersonationContext } from './impersonation-context';
import { readImpersonationCookie } from './impersonation-cookie';

/**
 * Turn the cookie on a request into the ambient context, or into the
 * reason it cannot have one.
 *
 * ── THE SESSION IS RE-READ ON EVERY REQUEST, BY ONE FUNCTION ────────
 * `ImpersonationService.loadUsableSession` is the session service's
 * single answer to "may this still be used?" — expired, ended, or never
 * OTP-verified — and it is called here rather than reimplemented. That
 * matters more than it looks: the clause most easily dropped by a second
 * copy is the OTP one, because an unverified row looks completely normal
 * (the row is created when the code is SENT, so an abandoned attempt is
 * an ordinary thing to find). One function, four callers, no copies.
 *
 * The cookie is therefore only a POINTER at the row. An admin ending a
 * session from the review screen takes effect on the NEXT request, not
 * whenever the cookie happens to run out.
 *
 * ── WHY THIS RETURNS A VERDICT INSTEAD OF THROWING ──────────────────
 * Its caller is express middleware, and an exception thrown there misses
 * Nest's exception filter entirely: the client would get an express HTML
 * error page instead of the `{code, message}` body every other refusal
 * in this API has. So the refusal is CARRIED — the exception object
 * itself, not a copy of its words — and `ImpersonationGuard`, which is
 * inside Nest, rethrows it. The session service's codes and sentences
 * reach the client exactly as it wrote them.
 */
export type ImpersonationVerdict =
  /** No cookie, or not one we signed. The overwhelmingly common answer. */
  | { readonly kind: 'none' }
  /** A cookie we signed, naming a session that may not be used. */
  | { readonly kind: 'refused'; readonly error: HttpException }
  | { readonly kind: 'ok'; readonly context: ImpersonationContext };

@Injectable()
export class ImpersonationSessionLoader {
  constructor(
    private readonly env: EnvService,
    private readonly sessions: ImpersonationService,
  ) {}

  async verdictFor(req: Request): Promise<ImpersonationVerdict> {
    const sessionId = readImpersonationCookie({ signingKey: this.env.jwtSigningKey, req });
    // The early return that keeps an ordinary seller request EXACTLY as
    // it was: no query, no context, nothing added to the request.
    if (sessionId === null) return { kind: 'none' };

    let claim: ImpersonationClaim;
    try {
      claim = await this.sessions.loadUsableSession(sessionId);
    } catch (err) {
      // Anything the session service refused with is passed through. A
      // failure that is NOT an HttpException — the database being down,
      // say — is rethrown for the middleware to turn into a refusal of
      // its own, because "we could not check" and "it is not valid" are
      // different answers and only one of them should quote a reason.
      if (err instanceof HttpException) return { kind: 'refused', error: err };
      throw err;
    }

    return {
      kind: 'ok',
      context: {
        sessionId: claim.sessionId,
        staffUserId: claim.staffUserId,
        subject: claim.subject,
        mayWrite: claim.mayWrite,
      },
    };
  }
}
