import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { EnvService } from '../../../config/env.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { TokenHashService } from '../../auth-common/services/token-hash.service';
import type { ImpersonationSubjectKind } from '../dto/impersonation.dto';
import {
  ImpersonationOtpService,
  MAX_IMPERSONATION_OTP_ATTEMPTS,
} from './impersonation-otp.service';

/**
 * Opening, proving and closing a support session.
 *
 * ── THE SHAPE OF THE THING ──────────────────────────────────────────
 * Three steps, and each one exists because the step before it is not
 * enough on its own:
 *
 *   start   — a row with a REASON, a 30-minute deadline and no access
 *             yet. Written before the code is sent, so an attempt
 *             somebody abandoned is still in the review.
 *   verify  — the code proves it is really that staff member, and only
 *             then does the session become usable. The answer is a
 *             handoff token, not a cookie; see below for why it cannot
 *             be a cookie.
 *   end     — explicitly, by the staff member or by a reviewer.
 *
 * ── WHY THIRTY MINUTES, AND WHY IT IS NEVER EXTENDED ────────────────
 * Long enough to read an order, a wallet and a shipment; short enough
 * that forgetting to close the tab is not standing access. There is
 * deliberately no renew: a session that can be extended is a second
 * login with a worse audit trail, and the staff member re-requesting
 * costs one more mail and leaves one more reviewable row, which is the
 * correct price.
 *
 * ── WHY NOTHING EXPIRES ANYTHING ───────────────────────────────────
 * There is no reaper job. `expiresAt` in the past IS expired —
 * `assertUsable` is the only authority and it is consulted on every
 * request, so a session cannot outlive its deadline merely because a
 * cron did not run. `endedAt` stays null on an expired-not-ended
 * session on purpose: "it ran out" and "somebody closed it" are
 * different facts and a reviewer wants to be able to tell them apart.
 */

/** The whole session, start to deadline. Never extended. */
export const IMPERSONATION_SESSION_TTL_MINUTES = 30;

/**
 * How long the handoff token lives: sixty seconds, one use.
 *
 * It is a bearer token travelling through a browser redirect, which is
 * the least private place we ever put a secret — it can land in
 * history, in a crash report, in a screenshot of the address bar. So it
 * is scoped to the only thing it has to survive: one navigation. A
 * minute covers a slow network and a cold page load; nothing legitimate
 * needs the second minute.
 */
export const IMPERSONATION_HANDOFF_TTL_SECONDS = 60;

const handoffKey = (tokenHash: string): string => `impersonation:handoff:${tokenHash}`;

/**
 * The fields `assertUsable` reads. Nothing else is its business.
 *
 * The three that decide the answer are required; `endedReason` and `id`
 * are optional because a guard loading this row on every request has no
 * reason to select either, and a usability test that forced it to would
 * be charging the hot path for a sentence only a human reads.
 */
export interface UsableImpersonationSession {
  readonly otpVerifiedAt: Date | null;
  readonly expiresAt: Date;
  readonly endedAt: Date | null;
  /** Quoted back to the caller when the loader happened to select it. */
  readonly endedReason?: string | null;
  readonly id?: string;
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * THE EXCHANGE CONTRACT — read this before building the guards.
 * ═══════════════════════════════════════════════════════════════════
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────
 * The admin console and the seller/reseller apps are on DIFFERENT
 * ORIGINS. Our session cookies are `__Host-` prefixed, which binds them
 * to the exact origin that set them and forbids a `Domain` attribute
 * altogether. So the obvious design — verify the code in the admin app
 * and set a seller session cookie in the response — is not merely
 * discouraged, it is impossible: the browser would drop the cookie.
 *
 * Dropping the `__Host-` prefix to make it possible would be the wrong
 * trade in the wrong direction. That prefix is what stops a subdomain
 * anybody ever stands up from writing a session cookie for the seller
 * app, and weakening every seller's login to make a support feature
 * convenient is not a trade worth discussing.
 *
 * ── THE ANSWER ──────────────────────────────────────────────────────
 * The seller/reseller origin sets its own cookie, in a response it
 * issues itself. `verify` hands back a HANDOFF TOKEN; the admin console
 * sends the browser to the other app with it; that app posts it to the
 * API and gets a session at its own origin. The token is the only thing
 * that crosses, and it is single-use and lives sixty seconds.
 *
 *   1. admin  POST /admin/impersonation/:id/verify  { code }
 *              → { handoff: { token, expiresAt, redirectUrl } }
 *   2. admin  navigates the browser to `redirectUrl`, which is
 *             `<seller|reseller app>/impersonation/handoff#token=…`.
 *             The token is in the FRAGMENT, not the query string:
 *             a fragment is never sent to a server, so it cannot land
 *             in an access log, and it is not forwarded in a `Referer`
 *             to anything the page loads.
 *   3. app    POST <its own origin's exchange endpoint> { token }
 *   4. api    `redeemHandoff(token)` → the claim, and the endpoint sets
 *             the seller/store session cookie on ITS origin.
 *
 * ── WHAT REDEEMING GUARANTEES, AND WHAT IT DOES NOT ─────────────────
 * `redeemHandoff` promises: the token was ours, it has not been used,
 * it is inside its sixty seconds, and the session behind it passes
 * `assertUsable`. It does NOT decide who may be impersonated or what
 * they may do — `mayWrite` comes back on the claim and enforcing it is
 * the guard's job, with `refusalFor()` from
 * `common/impersonation/forbidden-while-impersonating.ts`.
 *
 * Nothing else may mint a session. There is one door and this is it.
 */
export interface ImpersonationHandoffExchange {
  /**
   * Spend a handoff token. Single use: a second call with the same
   * token fails even inside the sixty seconds, because a token that
   * could be replayed would let anybody who saw the URL once ride
   * along for the rest of the session.
   *
   * `origin` is which app is spending it — 'SELLER' for the seller app's
   * exchange endpoint, 'STORE' for the reseller one. It is checked
   * against the session row, so a handoff minted for a seller cannot
   * open a store session even if the token itself is good. The ROW is
   * the authority on that rather than anything inside the token: a
   * claim a token carries about itself is only as trustworthy as the
   * minting, and the row is what a reviewer will be reading.
   *
   * Throws `UnauthorizedException` for an unknown, spent, expired or
   * malformed token, for a token presented at the wrong origin, and for
   * a token whose session has since been ended or run out.
   */
  redeemHandoff(token: string, origin: ImpersonationSubjectKind): Promise<ImpersonationClaim>;

  /**
   * The same call under the name the exchange endpoint's own contract
   * uses (`ImpersonationHandoffVerifier.verifyHandoff` in
   * `common/impersonation/handoff-token.contract.ts`).
   *
   * An alias and not a second implementation, and that is the entire
   * reason it exists: the guards were built against an ASSUMED verifier
   * while this side was being written, and the one failure mode worth
   * spending a method name to avoid is the two sides shipping with two
   * ways to mint a session, one of which nobody is maintaining. Matching
   * the name means reconciling is a provider swap
   * (`useExisting: ImpersonationService`) and a deleted placeholder,
   * rather than a rewrite under time pressure.
   *
   * The claim returned is a SUPERSET of what that contract asks for, so
   * it satisfies it structurally with no import either way.
   */
  verifyHandoff(token: string, origin: ImpersonationSubjectKind): Promise<ImpersonationClaim>;

  /**
   * Re-read the session behind a request that already has one, for the
   * guard to call per request. The cookie says which session; this says
   * whether it is still alive, so ending a session from the review
   * screen takes effect on the very next request rather than whenever
   * the cookie happens to expire.
   */
  loadUsableSession(sessionId: string): Promise<ImpersonationClaim>;

  /**
   * Count a request made inside a session, and whether it changed
   * anything. Best-effort and never throws: a counter that could fail
   * the request it is counting would be a worse bargain than a counter
   * that is occasionally one short.
   */
  noteRequest(sessionId: string, mutating: boolean): Promise<void>;
}

/**
 * Everything a guard needs to build an `ImpersonationContext` and
 * decide what the request may do. The field names line up with
 * `ImpersonationContext` on purpose — the guard should be able to pass
 * this almost straight to `runImpersonated`.
 */
export interface ImpersonationClaim {
  readonly sessionId: string;
  readonly staffUserId: string;
  readonly subject: { readonly kind: ImpersonationSubjectKind; readonly id: string };
  readonly mayWrite: boolean;
  /** When the SESSION dies — not the token, which is already spent. */
  readonly expiresAt: Date;
  /** Carried so a refusal can quote it back; it is the whole point. */
  readonly reason: string;
}

/**
 * What `verify` hands the admin console. The token is in here exactly
 * once, on its way to the browser — it is never audited, never logged
 * and never stored in plaintext.
 */
export interface ImpersonationHandoff {
  readonly token: string;
  readonly expiresAt: Date;
  /** Where to send the browser. Contains the token in its fragment. */
  readonly redirectUrl: string;
}

export interface StartImpersonationResult {
  readonly sessionId: string;
  /** The session deadline, which starts now and is not extended. */
  readonly expiresAt: Date;
  /** So the UI can say "check your mail" and name the address. */
  readonly otpSentTo: string;
  readonly otpExpiresAt: Date;
}

export interface VerifyImpersonationResult {
  readonly sessionId: string;
  readonly handoff: ImpersonationHandoff;
}

export interface ImpersonationSessionSummary {
  readonly id: string;
  readonly staffUserId: string;
  readonly staffEmail: string;
  readonly subject: { readonly kind: ImpersonationSubjectKind; readonly id: string };
  readonly subjectLabel: string;
  readonly reason: string;
  readonly mayWrite: boolean;
  readonly otpVerifiedAt: Date | null;
  readonly expiresAt: Date;
  readonly endedAt: Date | null;
  readonly endedReason: string | null;
  readonly ipAddress: string | null;
  readonly requestCount: number;
  readonly writeCount: number;
  readonly createdAt: Date;
  /** Verified, not ended, not past its deadline. The review's headline. */
  readonly live: boolean;
}

export interface ImpersonationClientContext {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
}

/**
 * THE one answer to "may this session still be used?".
 *
 * ── WHY ONE FUNCTION ────────────────────────────────────────────────
 * There are four places that have to ask: redeeming the handoff, every
 * guarded request afterwards, ending a session, and the review screen.
 * Four copies of a three-clause check is three chances for one of them
 * to drop a clause, and the clause most likely to be dropped is the
 * `otpVerifiedAt` one — because it is the only one that is not about
 * time, and because a session that has not cleared its second factor
 * LOOKS completely normal in the row. So there is one function, it is
 * pure, and it throws rather than returning a boolean: a caller cannot
 * forget to act on a thrown answer.
 *
 * `now` is a parameter so a test can sit either side of a deadline
 * without sleeping.
 */
export function assertUsable(session: UsableImpersonationSession, now: Date = new Date()): void {
  // ENDED is tested first, and that ordering is a real choice: a
  // session can be both ended and unverified at once — that is exactly
  // what five wrong codes leaves behind — and "this session has ended:
  // OTP attempts exhausted" tells the staff member what happened,
  // where "it was never confirmed" leaves them typing codes into
  // something that is already closed.
  if (session.endedAt !== null) {
    throw new UnauthorizedException({
      code: 'IMPERSONATION_SESSION_ENDED',
      message: session.endedReason
        ? `This support session has ended: ${session.endedReason}`
        : 'This support session has ended.',
    });
  }
  if (session.otpVerifiedAt === null) {
    throw new UnauthorizedException({
      code: 'IMPERSONATION_NOT_VERIFIED',
      message:
        'This support session has not cleared its emailed code yet, so it cannot be used for anything.',
    });
  }
  if (session.expiresAt.getTime() <= now.getTime()) {
    throw new UnauthorizedException({
      code: 'IMPERSONATION_SESSION_EXPIRED',
      message: 'This support session has run out. Request a new one, with a reason.',
    });
  }
}

/** The same question, where the answer is a fact rather than an error. */
export function isUsable(session: UsableImpersonationSession, now: Date = new Date()): boolean {
  try {
    assertUsable(session, now);
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class ImpersonationService implements ImpersonationHandoffExchange {
  private readonly logger = new Logger(ImpersonationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditLogService,
    private readonly otp: ImpersonationOtpService,
    private readonly hashes: TokenHashService,
    private readonly env: EnvService,
  ) {}

  /**
   * Step 1. Record the intent, mail the code, grant nothing.
   *
   * The row is written BEFORE the code is sent and the session is
   * unusable until the code comes back, so this call creates a
   * reviewable record and no access at all. That ordering is the point:
   * a staff member who requests ten sessions and verifies none has left
   * ten rows explaining themselves.
   */
  async start(input: {
    readonly staffUserId: string;
    readonly staffPermissions: readonly string[];
    readonly subject: { readonly kind: ImpersonationSubjectKind; readonly id: string };
    readonly reason: string;
    readonly mayWrite: boolean;
    readonly ctx?: ImpersonationClientContext | undefined;
  }): Promise<StartImpersonationResult> {
    /*
      ── WHY THE WRITE CHECK IS HERE AND NOT ON THE DECORATOR ────────

      `@RequirePermissions(a, b)` means "a OR b" (see the decorator),
      so it cannot express "always `support.impersonate`, and ALSO
      `support.impersonate.write` when the body asks for write". The
      requirement depends on the payload, which a decorator never sees.

      It lives in the service rather than the controller so it holds for
      every caller there will ever be — including a future queue job or
      a second controller — instead of holding for whichever entry point
      remembered to repeat it.
    */
    if (input.mayWrite && !input.staffPermissions.includes('support.impersonate.write')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message:
          'A write session needs `support.impersonate.write` as well. You can open a read-only session.',
      });
    }

    const staff = await this.prisma.client.staffUser.findFirst({
      where: { id: input.staffUserId, deletedAt: null },
      select: { id: true, email: true, emailDisplay: true },
    });
    if (staff === null) {
      throw new NotFoundException({ code: 'STAFF_NOT_FOUND', message: 'Staff user not found' });
    }

    // The target has to be real and live BEFORE a row exists, so the
    // review never shows a session against an account that was never
    // there — which reads as a bug and wastes the reviewer's time on a
    // typo. A soft-deleted account counts as not there: nobody can be
    // supported inside an account that has been closed.
    const subject = await this.resolveSubject(input.subject);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + IMPERSONATION_SESSION_TTL_MINUTES * 60_000);
    const reason = input.reason.trim();

    const session = await this.prisma.client.impersonationSession.create({
      data: {
        staffUserId: staff.id,
        sellerId: input.subject.kind === 'SELLER' ? input.subject.id : null,
        storeId: input.subject.kind === 'STORE' ? input.subject.id : null,
        reason,
        mayWrite: input.mayWrite,
        // Set by `verify` and by nothing else. Until then the session
        // exists and does nothing, which is the whole design.
        otpVerifiedAt: null,
        expiresAt,
        ipAddress: input.ctx?.ipAddress ?? null,
        userAgent: input.ctx?.userAgent ?? null,
      },
      select: { id: true },
    });

    const { otpExpiresAt } = await this.otp.issue({
      sessionId: session.id,
      staffUserId: staff.id,
      staffEmail: staff.email,
      staffName: staff.emailDisplay,
      subjectLabel: subject.label,
      mayWrite: input.mayWrite,
      reason,
      expiresAt,
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staff.id,
      actorId: staff.id,
      sellerId: subject.sellerId,
      action: 'support.impersonation.requested',
      entityType: 'impersonation_session',
      entityId: session.id,
      severity: 'HIGH',
      // Everything a reviewer needs and nothing that could identify the
      // code. The reason is here in full because the audit row is read
      // by people who will not have the session row in front of them.
      metadata: {
        subjectKind: input.subject.kind,
        subjectId: input.subject.id,
        subjectLabel: subject.label,
        mayWrite: input.mayWrite,
        reason,
        expiresAt: expiresAt.toISOString(),
        ipAddress: input.ctx?.ipAddress ?? null,
        userAgent: input.ctx?.userAgent ?? null,
        requestId: input.ctx?.requestId ?? null,
      },
    });

    return { sessionId: session.id, expiresAt, otpSentTo: staff.email, otpExpiresAt };
  }

  /**
   * Step 2. The code, and then the way in.
   *
   * A wrong code is audited every time. One `otp_failed` row is a
   * typo; five against one session, or a scatter of them across
   * sessions nobody verified, is the pattern this feature most needs to
   * be able to see — and it is invisible unless each failure is
   * written down as it happens.
   */
  async verify(input: {
    readonly sessionId: string;
    readonly staffUserId: string;
    readonly code: string;
    readonly ctx?: ImpersonationClientContext | undefined;
  }): Promise<VerifyImpersonationResult> {
    const session = await this.prisma.client.impersonationSession.findUnique({
      where: { id: input.sessionId },
      select: {
        id: true,
        staffUserId: true,
        sellerId: true,
        storeId: true,
        reason: true,
        mayWrite: true,
        otpVerifiedAt: true,
        expiresAt: true,
        endedAt: true,
        endedReason: true,
      },
    });
    if (session === null) {
      throw new NotFoundException({
        code: 'IMPERSONATION_SESSION_NOT_FOUND',
        message: 'No such support session',
      });
    }

    /*
      Somebody else's session is NOT FOUND, not FORBIDDEN.

      A distinguishable "that exists but is not yours" lets anybody
      holding `support.impersonate` sweep for live session ids, and a
      live session id plus a guessed code is the one thing standing
      between them and somebody else's account. The review screen is
      where other people's sessions are visible, and that is gated on
      `support.impersonate.review`.
    */
    if (session.staffUserId !== input.staffUserId) {
      throw new NotFoundException({
        code: 'IMPERSONATION_SESSION_NOT_FOUND',
        message: 'No such support session',
      });
    }
    if (session.endedAt !== null) {
      throw new BadRequestException({
        code: 'IMPERSONATION_SESSION_ENDED',
        message: 'This support session has already ended. Request a new one.',
      });
    }
    if (session.otpVerifiedAt !== null) {
      // Not an error worth a second code: the session is already live,
      // and re-verifying would be a way to mint handoff tokens on
      // demand from one emailed code.
      throw new BadRequestException({
        code: 'IMPERSONATION_ALREADY_VERIFIED',
        message: 'This support session has already been verified.',
      });
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({
        code: 'IMPERSONATION_SESSION_EXPIRED',
        message: 'This support session ran out before it was verified. Request a new one.',
      });
    }

    const check = await this.otp.check(session.id, input.code);
    if (!check.ok) {
      await this.audit.log({
        actorType: ActorType.STAFF,
        staffUserId: input.staffUserId,
        actorId: input.staffUserId,
        sellerId: session.sellerId,
        action: 'support.impersonation.otp_failed',
        entityType: 'impersonation_session',
        entityId: session.id,
        severity: 'HIGH',
        // `refusal` and a count, never the code and never the guess.
        // "They typed 041" is of no use to a reviewer and is exactly
        // the shape of thing that turns an append-only table into a
        // list of near-miss credentials.
        metadata: {
          refusal: check.refusal,
          attemptsLeft: check.attemptsLeft,
          ipAddress: input.ctx?.ipAddress ?? null,
          requestId: input.ctx?.requestId ?? null,
        },
      });

      if (check.refusal === 'ATTEMPTS_EXHAUSTED') {
        // The SESSION dies, not just the code. Leaving it open with a
        // fresh code would make the five-guess cap a five-guess pause.
        await this.closeSession(session.id, 'OTP attempts exhausted');
        await this.audit.log({
          actorType: ActorType.STAFF,
          staffUserId: input.staffUserId,
          actorId: input.staffUserId,
          sellerId: session.sellerId,
          action: 'support.impersonation.ended',
          entityType: 'impersonation_session',
          entityId: session.id,
          severity: 'HIGH',
          metadata: { endedReason: 'OTP attempts exhausted', endedBy: input.staffUserId },
        });
        throw new UnauthorizedException({
          code: 'IMPERSONATION_OTP_ATTEMPTS_EXHAUSTED',
          message: `That was the last of ${MAX_IMPERSONATION_OTP_ATTEMPTS} attempts, so this session is closed. Request a new one.`,
        });
      }

      throw new UnauthorizedException({
        code:
          check.refusal === 'NO_LIVE_CODE'
            ? 'IMPERSONATION_OTP_EXPIRED'
            : 'IMPERSONATION_OTP_INVALID',
        message:
          check.refusal === 'NO_LIVE_CODE'
            ? 'That code has expired or has already been used. Request a new session.'
            : `That code is not right. ${check.attemptsLeft} attempt(s) left before this session closes.`,
      });
    }

    const verifiedAt = new Date();
    /*
      A GUARDED update, not a read-then-write.

      Two tabs posting the same correct code would otherwise both pass
      the checks above and both mint a handoff token — two ways into one
      session from one emailed code. `otpVerifiedAt: null` in the WHERE
      means exactly one of them updates a row; the loser sees zero and
      is told the session is already verified.
    */
    const claimed = await this.prisma.client.impersonationSession.updateMany({
      where: { id: session.id, otpVerifiedAt: null, endedAt: null },
      data: { otpVerifiedAt: verifiedAt },
    });
    if (claimed.count === 0) {
      throw new BadRequestException({
        code: 'IMPERSONATION_ALREADY_VERIFIED',
        message: 'This support session has already been verified.',
      });
    }

    const subjectKind: ImpersonationSubjectKind = session.sellerId !== null ? 'SELLER' : 'STORE';
    const handoff = await this.issueHandoff({
      sessionId: session.id,
      kind: subjectKind,
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: input.staffUserId,
      actorId: input.staffUserId,
      sellerId: session.sellerId,
      action: 'support.impersonation.started',
      entityType: 'impersonation_session',
      entityId: session.id,
      severity: 'HIGH',
      // No token, no hash of a token, no redirect URL — the URL carries
      // the token in its fragment, so auditing it would audit the
      // secret. The session id is enough to join everything else to.
      metadata: {
        subjectKind,
        subjectId: session.sellerId ?? session.storeId,
        mayWrite: session.mayWrite,
        reason: session.reason,
        verifiedAt: verifiedAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        ipAddress: input.ctx?.ipAddress ?? null,
        userAgent: input.ctx?.userAgent ?? null,
        requestId: input.ctx?.requestId ?? null,
      },
    });

    return { sessionId: session.id, handoff };
  }

  /**
   * Step 3. Close it.
   *
   * Ending somebody else's needs `support.impersonate.review` — the
   * oversight half of the feature is useless if the reviewer can see a
   * session running and not stop it. Ending your OWN never needs a
   * permission beyond the one that opened it: nobody should have to ask
   * for help to get out of an account.
   *
   * Idempotent. An already-ended session is not an error — two people
   * pressing the same stop button is the expected way for this to be
   * used, and the first `endedAt` is the honest one.
   */
  async end(input: {
    readonly sessionId: string;
    readonly actorStaffUserId: string;
    readonly actorPermissions: readonly string[];
    readonly reason?: string | undefined;
    readonly ctx?: ImpersonationClientContext | undefined;
  }): Promise<ImpersonationSessionSummary> {
    const session = await this.prisma.client.impersonationSession.findUnique({
      where: { id: input.sessionId },
      select: { id: true, staffUserId: true, sellerId: true, endedAt: true },
    });
    if (session === null) {
      throw new NotFoundException({
        code: 'IMPERSONATION_SESSION_NOT_FOUND',
        message: 'No such support session',
      });
    }

    const isOwn = session.staffUserId === input.actorStaffUserId;
    if (!isOwn && !input.actorPermissions.includes('support.impersonate.review')) {
      // FORBIDDEN rather than NOT_FOUND here, unlike `verify`: by the
      // time somebody is pressing stop on a session they can see, the
      // id is not a secret from them — it came off the review screen —
      // and a 404 would read as a bug.
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message:
          'Ending somebody else’s support session needs `support.impersonate.review`. You can end your own.',
      });
    }

    const endedReason =
      input.reason?.trim() || (isOwn ? 'Ended by the staff member' : 'Ended by a reviewer');

    if (session.endedAt === null) {
      await this.closeSession(session.id, endedReason);
      await this.audit.log({
        actorType: ActorType.STAFF,
        staffUserId: input.actorStaffUserId,
        actorId: input.actorStaffUserId,
        sellerId: session.sellerId,
        action: 'support.impersonation.ended',
        entityType: 'impersonation_session',
        entityId: session.id,
        severity: 'HIGH',
        metadata: {
          endedReason,
          endedBy: input.actorStaffUserId,
          // Worth its own field: "a reviewer stopped this" is a
          // different event from "the operator closed their own tab",
          // and it is the one somebody will come looking for.
          endedSomebodyElses: !isOwn,
          ipAddress: input.ctx?.ipAddress ?? null,
          requestId: input.ctx?.requestId ?? null,
        },
      });
    }

    return this.requireSummary(session.id);
  }

  /** Everything still running, newest first. The review screen's top half. */
  async active(): Promise<readonly ImpersonationSessionSummary[]> {
    const now = new Date();
    const rows = await this.prisma.client.impersonationSession.findMany({
      where: {
        endedAt: null,
        expiresAt: { gt: now },
        // Unverified attempts are not "active" — nothing is happening
        // inside anybody's account. They show up in `list`, which is
        // where an abandoned request belongs.
        otpVerifiedAt: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: SUMMARY_SELECT,
    });
    return rows.map((r) => toSummary(r, now));
  }

  /** The history, filtered. Newest first and capped. */
  async list(filter: {
    readonly staffUserId?: string | undefined;
    readonly sellerId?: string | undefined;
    readonly storeId?: string | undefined;
    readonly limit?: number | undefined;
  }): Promise<readonly ImpersonationSessionSummary[]> {
    const now = new Date();
    const rows = await this.prisma.client.impersonationSession.findMany({
      where: {
        ...(filter.staffUserId === undefined ? {} : { staffUserId: filter.staffUserId }),
        ...(filter.sellerId === undefined ? {} : { sellerId: filter.sellerId }),
        ...(filter.storeId === undefined ? {} : { storeId: filter.storeId }),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(filter.limit ?? 50, 1), 200),
      select: SUMMARY_SELECT,
    });
    return rows.map((r) => toSummary(r, now));
  }

  // ── ImpersonationHandoffExchange ──────────────────────────────────

  async redeemHandoff(
    token: string,
    origin: ImpersonationSubjectKind,
  ): Promise<ImpersonationClaim> {
    const unauthorized = (): never => {
      // ONE message for every way a token can be bad. Telling the
      // caller apart "expired" from "already used" from "never
      // existed" tells somebody probing with tokens which of their
      // guesses got closest, and none of the three has a different
      // remedy: ask the staff member to verify again.
      throw new UnauthorizedException({
        code: 'IMPERSONATION_HANDOFF_INVALID',
        message: 'That support handoff link is not usable. Verify the session again.',
      });
    };
    if (typeof token !== 'string' || token.length < 20) unauthorized();

    /*
      Read and delete in ONE round trip, so the token is spent whatever
      happens next.

      A GET followed by a DEL leaves a window — measured in the
      milliseconds a Postgres read takes, which is plenty — where two
      requests both see the token and both go on to mint a session.
      MULTI makes the pair atomic, and the DEL happens even when the
      session behind the token turns out to be unusable: a token that
      survived a failed redemption would be a token worth retrying.
    */
    const tokenHash = this.hashes.sha256Hex(token);
    const key = handoffKey(tokenHash);
    const replies = await this.redis.client.multi().get(key).del(key).exec();
    const stored = replies?.[0]?.[1];
    if (typeof stored !== 'string' || stored === '') unauthorized();

    const sessionId = String(stored);
    const claim = await this.loadUsableSession(sessionId);
    // Checked AFTER the burn, deliberately. A token presented at the
    // wrong origin is spent either way — whoever did that either made a
    // mistake worth starting over from, or is probing, and in neither
    // case should the token still be good afterwards.
    if (claim.subject.kind !== origin) unauthorized();
    return claim;
  }

  /** See `ImpersonationHandoffExchange.verifyHandoff` — an alias, by design. */
  verifyHandoff(token: string, origin: ImpersonationSubjectKind): Promise<ImpersonationClaim> {
    return this.redeemHandoff(token, origin);
  }

  async loadUsableSession(sessionId: string): Promise<ImpersonationClaim> {
    const session = await this.prisma.client.impersonationSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        staffUserId: true,
        sellerId: true,
        storeId: true,
        reason: true,
        mayWrite: true,
        otpVerifiedAt: true,
        expiresAt: true,
        endedAt: true,
        endedReason: true,
      },
    });
    if (session === null) {
      throw new UnauthorizedException({
        code: 'IMPERSONATION_SESSION_NOT_FOUND',
        message: 'That support session no longer exists.',
      });
    }
    assertUsable(session);

    const kind: ImpersonationSubjectKind = session.sellerId !== null ? 'SELLER' : 'STORE';
    const id = session.sellerId ?? session.storeId;
    if (id === null) {
      // Unreachable while the migration's CHECK holds — one of the two
      // columns is always set. The throw is here because a session
      // pointing at nothing must refuse rather than default to
      // somebody.
      throw new UnauthorizedException({
        code: 'IMPERSONATION_SESSION_MALFORMED',
        message: 'That support session names no account.',
      });
    }

    return {
      sessionId: session.id,
      staffUserId: session.staffUserId,
      subject: { kind, id },
      mayWrite: session.mayWrite,
      expiresAt: session.expiresAt,
      reason: session.reason,
    };
  }

  /**
   * Counting UPDATEs still in flight.
   *
   * The guard fires `noteRequest` with `void` — on purpose, since the
   * seller's request must not wait on a sort key. In production that is
   * the whole story. In the e2e harness it is the leak shape CLAUDE.md
   * names: the UPDATE outlives the request, holds FK RowShareLocks on
   * `impersonation_sessions` (which references `staff_users`, `sellers`
   * and `seller_stores`, all RESTRICT) and can still be running when
   * `resetAuthState` issues its deletes — `40P01 deadlock detected`,
   * on one CI shard, naming neither the test nor the cause.
   *
   * So the writer holds its own handles, exactly as `NotificationListener`
   * and `OrderConfirmedAwbListener` do. The rule is written down in
   * CLAUDE.md as applying to ANY post-commit fire-and-forget that does
   * async DB work, and this is the fourth; `app-harness.ts` drains all
   * four together.
   */
  private readonly inFlight = new Set<Promise<void>>();

  /**
   * Wait for the counters to settle. Public so the e2e harness can
   * quiesce between tests; never called in production, where the point
   * of the `void` is that nobody waits.
   */
  async drainInFlight(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }

  noteRequest(sessionId: string, mutating: boolean): Promise<void> {
    const work = this.countRequest(sessionId, mutating);
    this.inFlight.add(work);
    // `finally` rather than `then`: the promise must leave the set even
    // when it rejects, or a single failure pins a handle for the life of
    // the process and every later drain waits on it. `countRequest`
    // swallows its own errors so this cannot reject today — the guard is
    // for the day somebody removes that catch.
    void work.finally(() => this.inFlight.delete(work));
    return work;
  }

  private async countRequest(sessionId: string, mutating: boolean): Promise<void> {
    try {
      await this.prisma.client.impersonationSession.update({
        where: { id: sessionId },
        data: {
          requestCount: { increment: 1 },
          ...(mutating ? { writeCount: { increment: 1 } } : {}),
        },
      });
    } catch (err) {
      // Swallowed on purpose. These counters exist so a reviewer can
      // sort by the busiest sessions without reading every audit row —
      // they are a convenience over the audit log, not the record
      // itself, and the record is written separately. Failing the
      // seller's request to keep a sort key accurate would be the wrong
      // way round.
      this.logger.warn({ err, sessionId }, 'Could not count an impersonated request');
    }
  }

  // --- internal ---

  /**
   * Mint the token and park its hash.
   *
   * Hash-stored for the same reason every other bearer token in this
   * codebase is: what Redis holds is useless to whoever reads Redis.
   * Thirty-two bytes of url-safe random — the refresh-token generator's
   * entropy, reused rather than reinvented, because the thing this
   * protects is a login.
   */
  private async issueHandoff(input: {
    readonly sessionId: string;
    readonly kind: ImpersonationSubjectKind;
  }): Promise<ImpersonationHandoff> {
    const token = this.hashes.generateRefreshToken();
    const expiresAt = new Date(Date.now() + IMPERSONATION_HANDOFF_TTL_SECONDS * 1000);

    // `NX` so a generated token can never overwrite a live one. The
    // chance is astronomically small; the consequence would be one
    // staff member's handoff silently pointing at another's session,
    // which is not a failure mode worth leaving to probability.
    const written = await this.redis.client.set(
      handoffKey(this.hashes.sha256Hex(token)),
      input.sessionId,
      'EX',
      IMPERSONATION_HANDOFF_TTL_SECONDS,
      'NX',
    );
    if (written !== 'OK') {
      throw new BadRequestException({
        code: 'IMPERSONATION_HANDOFF_NOT_ISSUED',
        message: 'Could not issue the handoff. Try verifying again.',
      });
    }

    // The FRAGMENT, not the query string. A fragment never leaves the
    // browser, so the token cannot land in our access logs, a proxy's,
    // or a `Referer` header sent to anything that page loads.
    const base = input.kind === 'SELLER' ? this.env.sellerAppUrl : this.env.resellerAppUrl;
    const redirectUrl = `${base.replace(/\/+$/, '')}/impersonation/handoff#token=${encodeURIComponent(token)}`;

    return { token, expiresAt, redirectUrl };
  }

  /** End the row, and forget any code still live for it. */
  private async closeSession(sessionId: string, endedReason: string): Promise<void> {
    await this.prisma.client.impersonationSession.updateMany({
      // `endedAt: null` keeps the FIRST ending. Two reviewers pressing
      // stop should not move the time somebody has to explain.
      where: { id: sessionId, endedAt: null },
      data: { endedAt: new Date(), endedReason: endedReason.slice(0, 500) },
    });
    // Handoff tokens are keyed by their own hash and cannot be
    // enumerated, so they are not deleted here. They do not need to be:
    // redeeming one calls `assertUsable`, which refuses an ended
    // session. The code, which IS keyed on the session, goes now.
    await this.otp.revoke(sessionId);
  }

  /** The target account, or a 404 naming which kind was not found. */
  private async resolveSubject(subject: {
    readonly kind: ImpersonationSubjectKind;
    readonly id: string;
  }): Promise<{ readonly label: string; readonly sellerId: string | null }> {
    if (subject.kind === 'SELLER') {
      const seller = await this.prisma.client.seller.findFirst({
        where: { id: subject.id, deletedAt: null },
        select: { id: true, companyName: true, email: true },
      });
      if (seller === null) {
        throw new NotFoundException({
          code: 'SELLER_NOT_FOUND',
          message: 'No live seller with that id',
        });
      }
      return { label: `${seller.companyName} (${seller.email})`, sellerId: seller.id };
    }

    const store = await this.prisma.client.sellerStore.findFirst({
      where: { id: subject.id, deletedAt: null },
      select: { id: true, name: true, displayName: true, sellerId: true },
    });
    if (store === null) {
      throw new NotFoundException({
        code: 'STORE_NOT_FOUND',
        message: 'No live store with that id',
      });
    }
    // The seller is carried onto the audit row as well as the store:
    // `audit_logs.seller_id` is what a seller-scoped review filters on,
    // and a support session inside a reseller store is something the
    // seller whose stock it sells has an interest in.
    return { label: store.displayName ?? store.name, sellerId: store.sellerId };
  }

  private async requireSummary(sessionId: string): Promise<ImpersonationSessionSummary> {
    const row = await this.prisma.client.impersonationSession.findUnique({
      where: { id: sessionId },
      select: SUMMARY_SELECT,
    });
    if (row === null) {
      throw new NotFoundException({
        code: 'IMPERSONATION_SESSION_NOT_FOUND',
        message: 'No such support session',
      });
    }
    return toSummary(row, new Date());
  }
}

/** One projection for every list, so the review screens cannot drift. */
const SUMMARY_SELECT = {
  id: true,
  staffUserId: true,
  sellerId: true,
  storeId: true,
  reason: true,
  mayWrite: true,
  otpVerifiedAt: true,
  expiresAt: true,
  endedAt: true,
  endedReason: true,
  ipAddress: true,
  requestCount: true,
  writeCount: true,
  createdAt: true,
  staff: { select: { email: true } },
  seller: { select: { companyName: true, email: true } },
  store: { select: { name: true, displayName: true } },
} as const;

/**
 * The row shape `toSummary` reads. Exported so a test can build one
 * without a database.
 */
export interface ImpersonationSummaryRow {
  readonly id: string;
  readonly staffUserId: string;
  readonly sellerId: string | null;
  readonly storeId: string | null;
  readonly reason: string;
  readonly mayWrite: boolean;
  readonly otpVerifiedAt: Date | null;
  readonly expiresAt: Date;
  readonly endedAt: Date | null;
  readonly endedReason: string | null;
  readonly ipAddress: string | null;
  readonly requestCount: number;
  readonly writeCount: number;
  readonly createdAt: Date;
  readonly staff: { readonly email: string };
  readonly seller: { readonly companyName: string; readonly email: string } | null;
  readonly store: { readonly name: string; readonly displayName: string | null } | null;
}

/**
 * Row to review line. Pure, so the `live` rule can be tested against a
 * fixed clock rather than against whatever time the test ran at.
 *
 * The user agent is deliberately NOT projected: it is long, it is noise
 * on a list, and it is on the row for whoever is investigating one
 * session in particular.
 */
export function toSummary(row: ImpersonationSummaryRow, now: Date): ImpersonationSessionSummary {
  const kind: ImpersonationSubjectKind = row.sellerId !== null ? 'SELLER' : 'STORE';
  const label =
    row.seller !== null && row.seller !== undefined
      ? `${row.seller.companyName} (${row.seller.email})`
      : (row.store?.displayName ?? row.store?.name ?? '(account no longer present)');
  return {
    id: row.id,
    staffUserId: row.staffUserId,
    staffEmail: row.staff.email,
    subject: { kind, id: row.sellerId ?? row.storeId ?? '' },
    subjectLabel: label,
    reason: row.reason,
    mayWrite: row.mayWrite,
    otpVerifiedAt: row.otpVerifiedAt,
    expiresAt: row.expiresAt,
    endedAt: row.endedAt,
    endedReason: row.endedReason,
    ipAddress: row.ipAddress,
    requestCount: row.requestCount,
    writeCount: row.writeCount,
    createdAt: row.createdAt,
    live: isUsable(row, now),
  };
}
