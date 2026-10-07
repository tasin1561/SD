import {
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActorType } from '@skydrop/db';
import type { Request } from 'express';
import { AuditLogService } from '../../modules/auth-common/services/audit-log.service';
import { ImpersonationService } from '../../modules/impersonation/services/impersonation.service';
import { currentImpersonation } from './impersonation-context';
import { SKIP_IMPERSONATION_GATE_KEY } from './skip-impersonation-gate.decorator';
import { isMutating, refusalFor } from './forbidden-while-impersonating';

/**
 * The server-side half of "read-only by default, and never these
 * routes". GLOBAL, so it cannot be forgotten on a new endpoint.
 *
 * ── WHY A GUARD AND NOT AN INTERCEPTOR ──────────────────────────────
 * This is a refusal, and a refusal belongs before the handler, before
 * the pipes, before anything has been read or written. An interceptor is
 * for wrapping something that is going to happen; a guard decides whether
 * it happens at all. Being a guard also puts it ahead of the seller and
 * store JWT guards, so a forbidden route is refused without a single
 * database lookup — and `/seller/api-keys` stays out of reach even if the
 * account's own authentication would have failed a moment later.
 *
 * (The ambient context is opened by `ImpersonationAlsMiddleware`, NOT
 * here — a guard cannot open an `AsyncLocalStorage` scope that outlives
 * itself. That file explains why at length.)
 *
 * ── WHY IT IS GLOBAL AND WHAT THAT COSTS ────────────────────────────
 * One `currentImpersonation()` read — an ALS `getStore()` — on every
 * request in the API, and for the ~100% that answer null, a `return true`
 * on the next line. The alternative is remembering to attach it to every
 * seller and store controller, and FE-2 is explicit that enforcement
 * cannot be something anybody has to remember: a new dangerous endpoint
 * has to be refused by default, not until somebody notices.
 *
 * ── THE REFUSAL SENTENCE IS NOT OURS TO WRITE ───────────────────────
 * `refusalFor` returns the sentence and it is passed through verbatim.
 * Those sentences explain why the thing is impossible in terms of the
 * person's account rather than the system's rules, and they are the only
 * explanation the staff member gets. Rewording them here would fork them.
 */
@Injectable()
export class ImpersonationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditLogService,
    private readonly sessions: ImpersonationService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const imp = currentImpersonation();
    const req = ctx.switchToHttp().getRequest<Request>();

    // ── NOT IMPERSONATING: the ordinary request, and the ordinary answer.
    if (imp === null) {
      const rejection = req.impersonationRejection;
      if (rejection === undefined) return true;
      // A cookie we signed, naming a session that is expired, ended or
      // never OTP-verified. The exchange endpoints opt out of this (see
      // the decorator), because a stale cookie must not stop somebody
      // starting a NEW session — that would be a support engineer locked
      // out by their own last visit.
      if (this.skipped(ctx)) return true;
      // Rethrown as the session service built it, so its codes
      // (IMPERSONATION_SESSION_ENDED and the rest) and its sentences
      // reach the client unaltered.
      if (rejection instanceof HttpException) throw rejection;
      throw new InternalServerErrorException({
        code: 'IMPERSONATION_SESSION_UNUSABLE',
        message: 'This support session could not be checked, so it was refused.',
      });
    }

    if (this.skipped(ctx)) return true;

    // The path WITHOUT the query string, which is what the deny list is
    // written against: `/seller/api-keys` must match
    // `/seller/api-keys?page=2`. There is no global route prefix on this
    // app, so `req.path` is already the path the list names.
    const path = req.path;
    const mutating = isMutating(req.method);
    const refusal = refusalFor(req.method, path, imp.mayWrite);

    /*
      ── COUNTING, AND WHY IT IS NOT AWAITED ─────────────────────────

      `noteRequest` is the session service's counting door and the only
      one — a second mechanism here would double-count or disagree. It is
      one `UPDATE … increment` per impersonated request, which is a write
      on the hot path; it is deliberately NOT awaited, so the request does
      not wait on it and does not queue behind the previous request's row
      lock on the way to being served. It never throws (it swallows its
      own failures), so there is no rejection to float.

      WHAT THAT COSTS: the counts a killed process had in flight. That is
      affordable because these two numbers are a REVIEW CONVENIENCE — the
      schema says so, "counted so a review can sort by the sessions that
      did the most without reading every audit row". The record of what a
      session actually DID is `audit_logs`, written synchronously per
      action and not approximate.

      Refused requests are counted too: the column asks how many requests
      the session MADE, and an attempt on a forbidden route is the most
      interesting request in the session. `writeCount` counts only
      mutations allowed to proceed, because a refused one changed nothing
      and a reviewer sorting by writes is looking for sessions that did
      something.
    */
    void this.sessions.noteRequest(imp.sessionId, mutating && refusal === null);

    if (refusal === null) return true;

    // Audited before throwing, like the status refusals in the two JWT
    // guards — and stamped with BOTH identities for free, because the
    // ambient context is still open around this call. `actorType` is
    // passed as the subject's and upgraded to STAFF_AS_* by the one
    // writer; see `audit-log.service.ts`.
    await this.audit.log({
      actorType: imp.subject.kind === 'SELLER' ? ActorType.SELLER : ActorType.STORE,
      sellerId: imp.subject.kind === 'SELLER' ? imp.subject.id : null,
      action: 'impersonation.request_refused',
      entityType: 'impersonation_session',
      entityId: imp.sessionId,
      metadata: {
        subjectKind: imp.subject.kind,
        subjectId: imp.subject.id,
        mayWrite: imp.mayWrite,
        why: refusal,
        path,
        method: req.method,
        ipAddress: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      },
      // HIGH, not MEDIUM: somebody with support.impersonate reached for a
      // password, an API key or a withdrawal inside a customer's account.
      // The list exists because those cannot be undone, so the attempt is
      // worth a reviewer's attention whether or not it was a misclick.
      severity: 'HIGH',
    });

    throw new ForbiddenException({ code: 'FORBIDDEN_WHILE_IMPERSONATING', message: refusal });
  }

  private skipped(ctx: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(SKIP_IMPERSONATION_GATE_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) === true
    );
  }
}
