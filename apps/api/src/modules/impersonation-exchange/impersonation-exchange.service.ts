import { Injectable } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import type { Request, Response } from 'express';
import { EnvService } from '../../config/env.service';
import { AuditLogService } from '../auth-common/services/audit-log.service';
import type { ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import type { ImpersonationSubjectKind } from '../impersonation/dto/impersonation.dto';
import { ImpersonationService } from '../impersonation/services/impersonation.service';
import {
  clearImpersonationCookie,
  readImpersonationCookie,
  setImpersonationCookie,
  signImpersonationCookie,
} from '../../common/impersonation/impersonation-cookie';

/** What the seller or store app shows in its "you are in a support session" banner. */
export interface ImpersonationSessionView {
  sessionId: string;
  subject: { kind: ImpersonationSubjectKind; id: string };
  mayWrite: boolean;
  expiresAt: string;
  reason: string;
}

/**
 * Spending a handoff token for a working session cookie, at the seller
 * and store origins.
 *
 * ── WHY THE COOKIE IS SET HERE AND NOT BY THE ADMIN CONSOLE ─────────
 * Our session cookies are `__Host-` prefixed, which binds them to the
 * exact origin that set them and forbids a `Domain` attribute. The admin
 * console physically cannot set a cookie for the seller app, and dropping
 * the prefix to make it possible would weaken every seller's login for
 * the sake of a support feature. So the token is the only thing that
 * crosses origins, and the seller/store origin sets its own cookie in a
 * response it issues itself. This is that response.
 *
 * ── THE TOKEN IS AN INTRODUCTION, NOT AN AUTHORITY ──────────────────
 * Nothing here reads the token's contents or takes its word for
 * anything. `redeemHandoff` burns it atomically, checks the origin
 * against the session ROW, and returns what the row says — including
 * `mayWrite`, which was decided, reviewed and recorded when the session
 * was opened and is not a claim a bearer token gets to make. So this
 * service has exactly two jobs the session service does not: mint the
 * cookie, and record that somebody walked through the door.
 */
@Injectable()
export class ImpersonationExchangeService {
  constructor(
    private readonly sessions: ImpersonationService,
    private readonly env: EnvService,
    private readonly audit: AuditLogService,
  ) {}

  async exchange(input: {
    readonly token: string;
    readonly origin: ImpersonationSubjectKind;
    readonly res: Response;
    readonly client: ClientInfoPayload;
  }): Promise<ImpersonationSessionView> {
    // Verifies, burns and judges the session behind it, in one call,
    // through the only door that can mint a session at all.
    const claim = await this.sessions.redeemHandoff(input.token, input.origin);

    // Expiring WITH the session rather than on a TTL of its own: a cookie
    // that outlived `expiresAt` would be refused on every request anyway,
    // and one that died first would end a session early for no reason
    // anybody could explain to the person using it.
    setImpersonationCookie(
      input.res,
      signImpersonationCookie({
        signingKey: this.env.jwtSigningKey,
        sessionId: claim.sessionId,
        expiresAt: claim.expiresAt,
      }),
      claim.expiresAt,
    );

    // Written as the STAFF member, not as the subject: at this instant
    // nobody is inside anybody's account yet, and the honest row is "this
    // person entered". Every row AFTER this one is stamped with both
    // identities by the audit writer, from the ambient context.
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: claim.staffUserId,
      actorId: claim.staffUserId,
      sellerId: claim.subject.kind === 'SELLER' ? claim.subject.id : null,
      action: 'impersonation.session_entered',
      entityType: 'impersonation_session',
      entityId: claim.sessionId,
      metadata: {
        subjectKind: claim.subject.kind,
        subjectId: claim.subject.id,
        mayWrite: claim.mayWrite,
        reason: claim.reason,
        expiresAt: claim.expiresAt.toISOString(),
        ipAddress: input.client.ipAddress,
        userAgent: input.client.userAgent,
        requestId: input.client.requestId,
      },
      // The moment a staff member is inside somebody's account. If a
      // reviewer reads one row about this session, it should be this one.
      severity: 'HIGH',
    });

    return {
      sessionId: claim.sessionId,
      subject: { kind: claim.subject.kind, id: claim.subject.id },
      mayWrite: claim.mayWrite,
      expiresAt: claim.expiresAt.toISOString(),
      reason: claim.reason,
    };
  }

  /**
   * Drop the cookie at this origin.
   *
   * It does NOT end the session — `impersonation_sessions.ended_at` is
   * the admin surface's to write, and a browser that has merely forgotten
   * its cookie is not the same fact as a session somebody ended. Said
   * plainly because the two are easy to confuse and only one of them is
   * visible to a reviewer.
   */
  leave(res: Response): void {
    clearImpersonationCookie(res);
  }

  /**
   * End the session for real, from inside the account.
   *
   * ── WHY THIS EXISTS BESIDE `leave` ──────────────────────────────────
   * `leave` forgets a cookie; the session keeps running until its
   * deadline and keeps showing as live on the review screen. That is the
   * honest meaning of dropping a cookie, but it is not what somebody
   * pressing a button marked End expects, and a review screen that lists
   * sessions nobody is in any more is a review screen people stop
   * trusting.
   *
   * The admin endpoint cannot serve this: it is behind `StaffJwtGuard`
   * and the browser inside the seller's account holds no staff
   * credential — by construction, that is the whole point of the
   * handoff. So the authority here is the SESSION COOKIE, which is
   * signed, names one session, and is only held by the staff member who
   * redeemed the handoff for it.
   *
   * Ending YOUR OWN session needs no permission; `end` already treats
   * that as always allowed, and the staff member is read off the row
   * rather than taken from the request, so this cannot close anybody
   * else's.
   */
  async endFromInside(input: {
    readonly req: Request;
    readonly res: Response;
    readonly client: ClientInfoPayload;
  }): Promise<void> {
    const sessionId = readImpersonationCookie({
      signingKey: this.env.jwtSigningKey,
      req: input.req,
    });
    // No cookie, or one whose signature does not check out: there is
    // nothing to end. Answered the same way as a successful end, so a
    // stranger poking at the route learns nothing about which session
    // ids are real.
    if (sessionId === null) {
      clearImpersonationCookie(input.res);
      return;
    }
    const claim = await this.sessions.loadUsableSession(sessionId);
    await this.sessions.end({
      sessionId: claim.sessionId,
      actorStaffUserId: claim.staffUserId,
      // Deliberately empty: `end` only consults permissions when the
      // session is somebody ELSE's, and this one is theirs by
      // definition — the id came from their own signed cookie.
      actorPermissions: [],
      reason: 'Ended from inside the account',
      ctx: {
        ipAddress: input.client.ipAddress,
        userAgent: input.client.userAgent,
        requestId: input.client.requestId,
      },
    });
    clearImpersonationCookie(input.res);
  }
}
