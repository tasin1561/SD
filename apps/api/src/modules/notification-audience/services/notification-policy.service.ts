import { Injectable } from '@nestjs/common';
import { NotificationCategory, NotificationChannel } from '@skydrop/db';

export interface ChannelPolicy {
  /** The only channels this category may EVER use. */
  readonly allowed: readonly NotificationChannel[];
  /**
   * false ⇒ the recipient cannot silence it at all, on any channel.
   * Nobody unsubscribes from "your password was changed".
   */
  readonly mutable: boolean;
  /** Shown when something asks why a channel was refused. */
  readonly reason: string;
}

/**
 * What KIND of notification this is decides which channels it may use.
 * Not a setting, not the sender's choice, not the recipient's.
 *
 * ── WHY CREDENTIAL IS EMAIL-ONLY BY CONSTRUCTION ─────────────────────
 * Every credential message fails, or actively backfires, in an inbox
 * you must already be signed in to read:
 *
 *   - a PASSWORD RESET is unreadable — being locked out is the reason
 *     it was sent;
 *   - a LOGIN ALERT is worse than useless — the only person who sees it
 *     is whoever is already inside, which is exactly who it is warning
 *     about, while the victim sees nothing;
 *   - an EMAIL VERIFICATION is circular — proving control of the
 *     mailbox is the entire point;
 *   - an INVITE has no account to deliver to yet.
 *
 * So this is a compile-time fact rather than a runtime check somebody
 * can misconfigure: the switch below is EXHAUSTIVE over
 * NotificationCategory (F2 — the same discipline as
 * CallOutcomeMappingService, TrackingStatusMappingService and
 * NotificationEventMappingService), so a new category fails to build
 * until someone consciously decides what it may use.
 */
@Injectable()
export class NotificationPolicyService {
  policyFor(category: NotificationCategory): ChannelPolicy {
    switch (category) {
      case NotificationCategory.CREDENTIAL:
        return {
          allowed: [NotificationChannel.EMAIL],
          mutable: false,
          reason:
            'Credential messages go to email only: an in-app one is unreadable when you are ' +
            'locked out, and a login alert shown in-app is seen by whoever is already inside.',
        };
      case NotificationCategory.OPERATIONAL:
        return {
          allowed: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
          mutable: true,
          reason: 'Something needs a person to act.',
        };
      case NotificationCategory.INFORMATIONAL:
        return {
          allowed: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
          mutable: true,
          reason: 'Worth knowing; nothing to do.',
        };
      case NotificationCategory.ANNOUNCEMENT:
        return {
          allowed: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
          mutable: true,
          reason: 'A message somebody chose to send to an audience.',
        };
      default: {
        // Exhaustiveness guard: a new category must be routed above
        // before this compiles.
        const never: never = category;
        throw new Error(`Unhandled notification category: ${String(never)}`);
      }
    }
  }

  /**
   * The channels this notification will actually use.
   *
   * Intersects what was ASKED FOR with what the category PERMITS, then
   * removes what the recipient has silenced — in that order, so a mute
   * can never widen the set and an asker can never bypass the policy.
   */
  resolveChannels(input: {
    readonly category: NotificationCategory;
    readonly requested: readonly NotificationChannel[];
    readonly mutedChannels?: readonly NotificationChannel[];
  }): readonly NotificationChannel[] {
    const policy = this.policyFor(input.category);
    const permitted = input.requested.filter((c) => policy.allowed.includes(c));
    if (!policy.mutable) return permitted;
    const muted = input.mutedChannels ?? [];
    return permitted.filter((c) => !muted.includes(c));
  }

  /** Can this person silence this category at all? */
  isMutable(category: NotificationCategory): boolean {
    return this.policyFor(category).mutable;
  }
}
