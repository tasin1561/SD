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
/**
 * TOPICS THAT CANNOT BE SILENCED, whatever their category (owner,
 * 2026-09-18).
 *
 * ── WHY A PER-TOPIC EXCEPTION AND NOT A NEW CATEGORY ─────────────────
 * The category answers "what KIND of message is this", and it decides
 * CHANNELS as well as mutability. A new category — `URGENT`, say — would
 * have to be given a channel list, would have to be routed in
 * `categoryForTemplate`, and would then be available to be attached to
 * anything, which is how "unmutable" spreads from one message to a dozen
 * over a year. It would also be a lie about this message: the 24-hour
 * reminder IS operational, in every respect except that it is the last
 * thing standing between a request and it closing unanswered.
 *
 * So the exception is exactly as narrow as the decision was: one named
 * topic, listed here with its reason, read by BOTH halves — the write
 * (`assertMutable` refuses to record the mute) and the read (`mutesFor`
 * ignores one recorded before this shipped, or by any future path). A
 * rule enforced only at the write is not a rule; it is a rule with a back
 * door for every row already in the table.
 */
export const IMMUTABLE_TOPICS: ReadonlyMap<string, string> = new Map([
  [
    'seller.store_request_reminder',
    'It is the only warning that a reseller store has been waiting a day for an answer. ' +
      'Silenced, the request closes itself, the store is told nobody answered, and their ' +
      'customer is left on a promise nobody kept.',
  ],
  // ── A RESELLER STORE'S THREE UNSILENCEABLE KINDS (owner, 2026-09-19) ──
  //
  // The owner named three: the ANSWER to something the store asked,
  // anything about its MONEY, and a CHANGE to one of its orders. Each is
  // listed here individually rather than as a rule over categories,
  // because `IMMUTABLE_TOPICS` is what BOTH halves read — the write
  // (`assertMutable`) and the read (`mutesFor`) — and a rule that has to
  // be re-derived in two places is a rule that will disagree with itself.
  //
  // What they have in common is the shape of the failure: the store
  // cannot find out any other way and has a customer waiting on the
  // answer. A seller's order notification silenced is a seller not
  // watching their own business; a store's decision notification silenced
  // is a store repeating a promise that has already been broken.
  [
    'store.request_approved',
    'It is the answer to something your store asked for. Silenced, nobody at the store ' +
      'learns the seller said yes, and the customer is told whatever was true yesterday.',
  ],
  [
    'store.request_rejected',
    'It is the answer to something your store asked for. Silenced, the store keeps waiting ' +
      'for a decision that has already been made, and the customer with it.',
  ],
  [
    'store.request_expired',
    'It says nobody answered in time and the request closed itself. Silenced, the store ' +
      'believes it is still being considered.',
  ],
  [
    'store.action_approved',
    'It is the answer to something your store asked for about a live parcel. Silenced, the ' +
      'store does not know whether the customer is being called again or the parcel turned round.',
  ],
  [
    'store.action_rejected',
    'It is the answer to something your store asked for about a live parcel. Silenced, the ' +
      'store waits on a van, a call or a return that is not coming.',
  ],
  [
    'store.address_change_approved',
    'It says whether the delivery details on one of your orders actually moved — including ' +
      'when the seller agreed and the courier then refused. Silenced, a parcel goes to the ' +
      'old address with the store believing it was corrected.',
  ],
  [
    'store.address_change_rejected',
    'It is the answer to a correction your store asked for. Silenced, the parcel keeps the ' +
      'old address and nobody at the store knows why.',
  ],
  [
    'store.order_changed_by_seller',
    'Somebody else changed one of YOUR orders — what is in it, what the customer pays, or ' +
      'who it goes to. Silenced, the store finds out from the customer.',
  ],
  [
    'store.ticket_resolved',
    'A settled dispute moves money between your store and the seller, and your wallet is ' +
      'the only other place it shows. Silenced, a balance changes with nothing to say why.',
  ],
]);

@Injectable()
export class NotificationPolicyService {
  /**
   * Can this TOPIC be silenced at all? Asked before the category, because
   * a named exception overrides it.
   */
  isTopicMutable(topic: string): boolean {
    return !IMMUTABLE_TOPICS.has(topic);
  }

  /** Why a topic cannot be silenced, for the refusal and the screen. */
  topicImmutableReason(topic: string): string | null {
    return IMMUTABLE_TOPICS.get(topic) ?? null;
  }

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
    /** When given, a topic on `IMMUTABLE_TOPICS` ignores every mute. */
    readonly topic?: string;
  }): readonly NotificationChannel[] {
    const policy = this.policyFor(input.category);
    const permitted = input.requested.filter((c) => policy.allowed.includes(c));
    if (!policy.mutable) return permitted;
    if (input.topic !== undefined && !this.isTopicMutable(input.topic)) return permitted;
    const muted = input.mutedChannels ?? [];
    return permitted.filter((c) => !muted.includes(c));
  }

  /** Can this person silence this category at all? */
  isMutable(category: NotificationCategory): boolean {
    return this.policyFor(category).mutable;
  }
}
