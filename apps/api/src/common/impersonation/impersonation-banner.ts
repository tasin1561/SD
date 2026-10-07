import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { currentImpersonation } from './impersonation-context';

/**
 * What the banner inside somebody's account needs to know.
 *
 * ── WHY `/me` AND NOT THE EXCHANGE RESPONSE ─────────────────────────
 * The exchange endpoint already returns all of this, once, at the
 * moment the staff member arrives. A banner is needed on EVERY page —
 * after a reload, after a navigation, in a tab opened from a link — and
 * none of those go through the exchange again. `/me` is the one call
 * every authed page already makes, so the fact rides along with it.
 *
 * ── IT IS A COURTESY, NOT A CONTROL ─────────────────────────────────
 * FE-2: nothing is decided by this. The guard refuses what a support
 * session may not do whether or not a bar is on screen. What this
 * prevents is the human failure the feature actually carries — somebody
 * forgetting whose account they are in and "fixing" something.
 *
 * Null for every ordinary request, which is almost all of them: a real
 * seller, a real store user, an API key, a background job.
 */
export interface ImpersonationBannerContext {
  readonly sessionId: string;
  readonly mayWrite: boolean;
  readonly expiresAt: string;
  readonly staffEmail: string;
}

@Injectable()
export class ImpersonationBannerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reads the ambient context, then the row — because `expiresAt` can
   * have moved (a session ended early from the review screen) and the
   * staff member's address is not in the context at all. One indexed
   * lookup by primary key, on impersonated requests only.
   *
   * Never throws: a banner that could 500 somebody's dashboard would be
   * a worse bug than a missing banner.
   */
  async current(): Promise<ImpersonationBannerContext | null> {
    const imp = currentImpersonation();
    if (imp === null) return null;
    try {
      const row = await this.prisma.client.impersonationSession.findUnique({
        where: { id: imp.sessionId },
        select: {
          id: true,
          mayWrite: true,
          expiresAt: true,
          endedAt: true,
          staff: { select: { emailDisplay: true } },
        },
      });
      // An ended session still reaching here means the guard let a
      // request through that it should not have; say nothing rather
      // than draw a bar claiming a live session.
      if (row === null || row.endedAt !== null) return null;
      return {
        sessionId: row.id,
        mayWrite: row.mayWrite,
        expiresAt: row.expiresAt.toISOString(),
        staffEmail: row.staff.emailDisplay,
      };
    } catch {
      return null;
    }
  }
}
