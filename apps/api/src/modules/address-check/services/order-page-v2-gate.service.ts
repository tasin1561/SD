import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { currentImpersonation } from '../../../common/impersonation/impersonation-context';

const AUDIENCE_KEY = 'orders.page_v2_audience';
const ALLOWLIST_KEY = 'orders.page_v2_allowlist';

export type V2Audience = 'OFF' | 'STAFF' | 'ALL';

/** The ids that may appear in the pilot list, for one caller. They are
 *  UUIDs from three different tables and cannot collide, which is why
 *  one flat list serves all three consoles. */
export interface V2Identity {
  readonly sellerId: string;
  readonly storeId?: string | undefined;
  readonly storeUserId?: string | undefined;
}

/**
 * Who may reach the new order page.
 *
 * ── WHY `STAFF` IS NOT "a staff account" ─────────────────────────────
 * The three v2 pages live in the CLIENT, MEMBER STORE and ASSOCIATE
 * consoles, whose users are not staff and never will be — and admin has
 * no order-creation page at all, so there is nowhere for a staff
 * account to use one. "Staff only" therefore has to mean something
 * concrete in those consoles, and it means two things (owner,
 * 2026-10-26): an account named in the pilot list, or a session where
 * staff are impersonating. The first is how a real seller is added to
 * the pilot without a deploy; the second is how the owner tests it
 * himself today.
 *
 * ── IT FAILS CLOSED, UNLIKE MOST SETTINGS READS ──────────────────────
 * A missing row, an unreadable value, a database that will not answer:
 * all of them mean OFF. This gate decides whether an unproven page is
 * shown to somebody placing real orders, so "we could not tell" has to
 * resolve to the page that has been working for a year. That is the
 * opposite of the usual convention here and is deliberate.
 */
@Injectable()
export class OrderPageV2GateService {
  private readonly logger = new Logger(OrderPageV2GateService.name);

  constructor(private readonly prisma: PrismaService) {}

  async audience(): Promise<V2Audience> {
    try {
      const row = await this.prisma.client.systemSetting.findUnique({
        where: { key: AUDIENCE_KEY },
        select: { valueString: true },
      });
      const value = (row?.valueString ?? '').trim().toUpperCase();
      return value === 'ALL' || value === 'STAFF' ? value : 'OFF';
    } catch (e) {
      this.logger.warn(
        { err: e instanceof Error ? e.message : String(e) },
        `${AUDIENCE_KEY} unreadable — order page v2 stays OFF`,
      );
      return 'OFF';
    }
  }

  async isEnabledFor(who: V2Identity): Promise<boolean> {
    const audience = await this.audience();
    if (audience === 'OFF') return false;
    if (audience === 'ALL') return true;

    // Staff impersonating any of the three consoles are in the pilot by
    // definition — that is how the owner uses a page that belongs to
    // somebody else's console.
    if (currentImpersonation() !== null) return true;

    const allow = await this.allowlist();
    // Both sides lower-cased: a UUID pasted from a database client can
    // arrive upper-cased, and a pilot that silently does not include
    // the account somebody just added is the worst kind of not-working.
    return [who.sellerId, who.storeId, who.storeUserId].some(
      (id) => id !== undefined && id !== '' && allow.has(id.trim().toLowerCase()),
    );
  }

  /**
   * Refuse as NOT FOUND, never as forbidden.
   *
   * A 403 on `/orders/new-v2` tells anyone who asks that the route
   * exists and they are not in the pilot, which invites "why not me"
   * and leaks a half-built page's existence to every seller. `off`
   * means the route is not there.
   */
  async assertEnabledFor(who: V2Identity): Promise<void> {
    if (await this.isEnabledFor(who)) return;
    throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
  }

  private async allowlist(): Promise<ReadonlySet<string>> {
    try {
      const row = await this.prisma.client.systemSetting.findUnique({
        where: { key: ALLOWLIST_KEY },
        select: { valueJson: true },
      });
      const raw = row?.valueJson;
      if (!Array.isArray(raw)) return new Set();
      return new Set(
        raw.filter((v): v is string => typeof v === 'string').map((v) => v.trim().toLowerCase()),
      );
    } catch (e) {
      this.logger.warn(
        { err: e instanceof Error ? e.message : String(e) },
        `${ALLOWLIST_KEY} unreadable — treating the pilot as empty`,
      );
      return new Set();
    }
  }
}
