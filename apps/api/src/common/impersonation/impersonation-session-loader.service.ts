import { HttpException, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { EnvService } from '../../config/env.service';
import {
  ImpersonationService,
  type ImpersonationClaim,
} from '../../modules/impersonation/services/impersonation.service';
import type { ImpersonationContext } from './impersonation-context';
import { ActorType } from '@skydrop/db';
import { AuditLogService } from '../../modules/auth-common/services/audit-log.service';
import { IMPERSONATION_COOKIE, inspectImpersonationCookie } from './impersonation-cookie';

/** Seller / store authed API surface, optionally behind a /vN prefix. */
const AUTHED_SURFACE = /^\/(v\d+\/)?(seller|store)\//i;
const ABSENT_THROTTLE_MS = 60_000;
const ABSENT_THROTTLE_MAX_KEYS = 5_000;

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
  private readonly logger = new Logger(ImpersonationSessionLoader.name);
  private readonly absentSeenAt = new Map<string, number>();

  constructor(
    private readonly env: EnvService,
    private readonly sessions: ImpersonationService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * OBSERVABILITY ONLY. Records why a request got no support session.
   * Never throws and never changes the verdict. Writes the reason code,
   * path, method and cookie NAMES; never the cookie value or any part of
   * a token.
   *
   * - Cookie present but unusable: always recorded (rare, and exactly the
   *   evidence wanted).
   * - Cookie absent: recorded only on the seller/store authed surface AND
   *   when the request carries no Authorization header. An ordinary
   *   signed-in seller always sends a bearer, so a bearer-less request to
   *   an authed route is the shape of a support session that lost its
   *   cookie. Throttled to one row per client IP per minute.
   */
  private async reportNoSession(
    req: Request,
    reason: string,
    cookiePresent: boolean,
  ): Promise<void> {
    try {
      const path = req.path;
      const hasBearer = typeof req.headers?.authorization === 'string';
      if (!cookiePresent) {
        if (!AUTHED_SURFACE.test(path) || hasBearer) return;
        const key = req.ip ?? 'unknown';
        const now = Date.now();
        const last = this.absentSeenAt.get(key);
        if (last !== undefined && now - last < ABSENT_THROTTLE_MS) return;
        if (this.absentSeenAt.size >= ABSENT_THROTTLE_MAX_KEYS) this.absentSeenAt.clear();
        this.absentSeenAt.set(key, now);
      }
      const jar = (req as unknown as { cookies?: Record<string, unknown> }).cookies;
      const metadata = {
        reason,
        path,
        method: req.method,
        hasBearer,
        cookiesParsed: jar !== undefined && jar !== null,
        // Names only, never values.
        cookieNames: jar ? Object.keys(jar).slice(0, 20) : [],
        host: req.headers?.host ?? null,
        ipAddress: req.ip ?? null,
      };
      this.logger.warn(
        { ...metadata, cookie: IMPERSONATION_COOKIE },
        'impersonation cookie not usable',
      );
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        action: cookiePresent ? 'impersonation.cookie_rejected' : 'impersonation.cookie_missing',
        entityType: 'impersonation_cookie',
        entityId: null,
        metadata,
        severity: cookiePresent ? 'HIGH' : 'MEDIUM',
      });
    } catch {
      // Diagnostics must never alter or fail a request.
    }
  }

  async verdictFor(req: Request): Promise<ImpersonationVerdict> {
    const inspected = inspectImpersonationCookie({ signingKey: this.env.jwtSigningKey, req });
    // The early return that keeps an ordinary seller request EXACTLY as
    // it was: no query, no context, nothing added to the request.
    if (!inspected.ok) {
      const present =
        inspected.reason !== 'COOKIE_ABSENT' && inspected.reason !== 'COOKIES_NOT_PARSED';
      await this.reportNoSession(req, inspected.reason, present);
      return { kind: 'none' };
    }
    const sessionId = inspected.sessionId;

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
