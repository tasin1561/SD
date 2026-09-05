import { Injectable, Logger } from '@nestjs/common';
import { NotificationCategory, type SellerNotificationCategory } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export interface PreferenceDecision {
  /** May the company be emailed about this at all? */
  readonly email: boolean;
  /** May it reach the inboxes of the people there? */
  readonly inApp: boolean;
  /**
   * How long the EMAIL should wait, in ms, because it landed inside
   * the company's quiet hours. Zero means send now.
   */
  readonly emailDelayMs: number;
}

const SEND_EVERYTHING: PreferenceDecision = { email: true, inApp: true, emailDelayMs: 0 };

/**
 * What a COMPANY has said it wants to hear about.
 *
 * ── THE ONE READER ON THE SEND PATH ──────────────────────────────────
 * `seller_notification_preferences` has existed since M1 with a screen
 * behind it and, until now, exactly one reader: its own CRUD service.
 * A seller could switch a category off, see it save, and keep getting
 * the emails — the settings were stored and never consulted. This is
 * the consultation. It is deliberately the ONLY place the rows are read
 * for a send decision, the same discipline `BinPolicyService` and
 * `WarehouseResolverService` are under: five call sites each deciding
 * what a preference means is how they come to disagree.
 *
 * ── TWO GRAINS, BOTH NARROWING ───────────────────────────────────────
 * This is the COMPANY's say, per category. A PERSON's own per-topic
 * mutes (NOTIF-9..13) narrow it further for their own inbox. Neither
 * overrides the other in a surprising direction — both can only ever
 * remove a delivery, never add one.
 *
 * ── FAILS OPEN ───────────────────────────────────────────────────────
 * A preferences outage must not silence a seller's order notifications.
 * The two failure modes are not symmetric: sending one email somebody
 * had switched off is a nuisance; silently not telling them their
 * parcel came back is money. Same reasoning as `InventoryModeService`
 * failing open to NORMAL.
 *
 * ── WHAT IT DOES NOT DECIDE ──────────────────────────────────────────
 * CREDENTIAL messages never reach here — they are sent by the legacy
 * fire-once callers, not the lifecycle listener — and the guard below
 * makes that structural rather than incidental. Nobody unsubscribes
 * from a password reset (NOTIF-9), so a preference row must not be able
 * to suppress one even if a future change routes it through this path.
 */
@Injectable()
export class SellerNotificationPreferenceResolver {
  private readonly logger = new Logger(SellerNotificationPreferenceResolver.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolve(input: {
    readonly sellerId: string;
    readonly category: SellerNotificationCategory;
    /** The notification's own category — CREDENTIAL is never gated. */
    readonly notificationCategory?: NotificationCategory;
    readonly now?: Date;
  }): Promise<PreferenceDecision> {
    if (input.notificationCategory === NotificationCategory.CREDENTIAL) return SEND_EVERYTHING;

    try {
      const row = await this.prisma.client.sellerNotificationPreference.findFirst({
        where: { sellerId: input.sellerId, category: input.category },
        select: {
          emailEnabled: true,
          inAppEnabled: true,
          quietHoursStart: true,
          quietHoursEnd: true,
          timezone: true,
        },
      });
      // No row is not a refusal. A company registered before this
      // category existed has nothing to say about it yet, and reading
      // silence as "no" would switch off a notification nobody chose to
      // switch off.
      if (row === null) return SEND_EVERYTHING;

      return {
        email: row.emailEnabled,
        inApp: row.inAppEnabled,
        // Quiet hours delay the EMAIL only. An inbox line does not
        // wake anybody — it is a list somebody looks at when they
        // choose to — and the in-app row IS the delivery, so there is
        // nothing to hold back without losing it.
        emailDelayMs: row.emailEnabled
          ? quietHoursDelayMs(
              row.quietHoursStart,
              row.quietHoursEnd,
              row.timezone,
              input.now ?? new Date(),
            )
          : 0,
      };
    } catch (err) {
      this.logger.warn(
        {
          sellerId: input.sellerId,
          category: input.category,
          err: err instanceof Error ? err.message : String(err),
        },
        'Notification preferences unreadable — sending anyway (fails open)',
      );
      return SEND_EVERYTHING;
    }
  }
}

/**
 * How long to hold an email so it lands after quiet hours end.
 *
 * The window is expressed in the COMPANY's own timezone as two "HH:MM"
 * strings, and it may wrap midnight (22:00 → 07:00 is the ordinary
 * case, and is the whole reason this cannot be a simple `>= start &&
 * < end`). The IANA zone is read through `Intl` rather than a stored
 * offset, which drifts an hour twice a year (the WAL-3 lesson).
 *
 * Exported for its own tests: the wrapping window and the DST-safe
 * local-time read are exactly the parts that look right and are not.
 */
export function quietHoursDelayMs(
  start: string | null,
  end: string | null,
  timezone: string,
  now: Date,
): number {
  if (start === null || end === null || start === end) return 0;

  const localMinutes = minutesOfDayIn(timezone, now);
  if (localMinutes === null) return 0;

  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  if (startMin === null || endMin === null) return 0;

  const wraps = startMin > endMin;
  const inQuiet = wraps
    ? localMinutes >= startMin || localMinutes < endMin
    : localMinutes >= startMin && localMinutes < endMin;
  if (!inQuiet) return 0;

  // Minutes until the window ends, counting across midnight when it
  // wraps. Never zero: a message that arrives exactly at the boundary
  // is already outside the window by the check above.
  const until = endMin > localMinutes ? endMin - localMinutes : 24 * 60 - localMinutes + endMin;
  return until * 60_000;
}

function toMinutes(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (m === null) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes since local midnight in an IANA zone, or null if unusable. */
function minutesOfDayIn(timezone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(at);
    const hour = parts.find((p) => p.type === 'hour')?.value;
    const minute = parts.find((p) => p.type === 'minute')?.value;
    if (hour === undefined || minute === undefined) return null;
    // 'en-GB' renders midnight as 24 in some runtimes.
    return (Number(hour) % 24) * 60 + Number(minute);
  } catch {
    // An unparseable timezone is a data problem, not a reason to hold
    // somebody's email indefinitely.
    return null;
  }
}
