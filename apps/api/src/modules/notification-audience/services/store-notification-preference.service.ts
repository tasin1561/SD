import { Injectable, Logger } from '@nestjs/common';
import { NotificationCategory, NotificationChannel, StoreNotificationCategory } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { IMMUTABLE_TOPICS } from './notification-policy.service';
import {
  NotificationTopicCatalogService,
  STORE_TOPICS,
} from './notification-topic-catalog.service';

/** What a store has said about one category, as the send path reads it. */
export interface StoreChannelDecision {
  readonly email: boolean;
  readonly inApp: boolean;
}

const SEND_EVERYTHING: StoreChannelDecision = { email: true, inApp: true };

/** One row as the store's own settings page reads it. */
export interface StoreCategoryView {
  readonly category: StoreNotificationCategory;
  readonly emailEnabled: boolean;
  readonly inAppEnabled: boolean;
  /**
   * False when EVERY topic in this category is one the owner said can
   * never be silenced — in which case the screen shows it locked rather
   * than offering a switch the dispatcher ignores.
   */
  readonly mutable: boolean;
  /** The topics in it, so the screen can say what is actually covered. */
  readonly topics: readonly string[];
  /** The topics in it that can never be silenced. */
  readonly lockedTopics: readonly string[];
  /** True once the store has said something; false means "the default". */
  readonly set: boolean;
}

/**
 * What a reseller STORE — as a whole, for everybody signed in to it —
 * has said it wants to hear about (2026-09-19, owner decision (c)).
 *
 * ── THE ONE READER ON THE SEND PATH ──────────────────────────────────
 * `SellerNotificationPreferenceResolver` is this service's twin, and it
 * exists because `seller_notification_preferences` shipped with a screen
 * and no reader for months: a seller could switch a category off, watch
 * it save, and keep receiving every email. This is written with a reader
 * from the first commit, and it is deliberately the ONLY one — the same
 * discipline `BinPolicyService` and `WarehouseResolverService` are under.
 * The dispatcher asks it; nothing else reads those rows to decide a send.
 *
 * ── TWO LAYERS, BOTH NARROWING ───────────────────────────────────────
 * This is the STORE's say, per category, applying to everybody there. A
 * PERSON's own per-topic mute (`notification_subscriptions`, keyed on
 * STORE_USER) narrows it further for their own bell. Neither can widen
 * the other: both only ever REMOVE a channel, so they compose by
 * intersection and the order they are applied in cannot matter.
 *
 * ── AN IMMUTABLE TOPIC IGNORES THIS LAYER TOO ────────────────────────
 * That is the whole point of putting the decision in one place. A rule
 * enforced only against a person's own mute would leave the store-wide
 * switch as a back door to exactly the silence the owner forbade — and
 * it would be a WORSE back door, because one admin at the store could
 * take it away from everybody. `decide()` refuses to gate a topic on
 * `IMMUTABLE_TOPICS`, and the WRITE half refuses to record a preference
 * for a category with nothing mutable in it.
 *
 * ── FAILS OPEN, AND AN ABSENT ROW MEANS SEND ─────────────────────────
 * A preferences outage, or a store that predates a category, must not
 * silence anything. The two failure modes are not symmetric: sending one
 * message somebody switched off is a nuisance; silently not telling a
 * store its dispute was settled is money.
 */
@Injectable()
export class StoreNotificationPreferenceService {
  private readonly logger = new Logger(StoreNotificationPreferenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: NotificationTopicCatalogService,
  ) {}

  /**
   * May this topic leave the building for this store, and on which
   * channels? Asked once per store per dispatch.
   */
  async decide(input: {
    readonly storeId: string;
    readonly topic: string;
    /** The notification's own category — CREDENTIAL is never gated. */
    readonly notificationCategory?: NotificationCategory;
  }): Promise<StoreChannelDecision> {
    if (input.notificationCategory === NotificationCategory.CREDENTIAL) return SEND_EVERYTHING;
    // The owner's three kinds ignore both layers (see the header).
    if (IMMUTABLE_TOPICS.has(input.topic)) return SEND_EVERYTHING;

    const category = this.catalog.storeCategoryOf(input.topic);
    // A topic the catalogue does not know is not gated: a message with no
    // switch behind it must still arrive.
    if (category === null) return SEND_EVERYTHING;

    try {
      const row = await this.prisma.client.storeNotificationPreference.findUnique({
        where: { storeId_category: { storeId: input.storeId, category } },
        select: { emailEnabled: true, inAppEnabled: true },
      });
      if (row === null) return SEND_EVERYTHING;
      return { email: row.emailEnabled, inApp: row.inAppEnabled };
    } catch (err) {
      this.logger.warn(
        {
          storeId: input.storeId,
          topic: input.topic,
          err: err instanceof Error ? err.message : String(err),
        },
        'Store notification preferences unreadable — sending anyway (fails open)',
      );
      return SEND_EVERYTHING;
    }
  }

  /**
   * Every category, with what the store has said and what it covers.
   *
   * Returns ALL of them, including ones with nothing mutable in them,
   * so the screen can show those LOCKED with their topics rather than
   * leaving a person to wonder where a message they can see in their
   * inbox is configured. A control that always refuses is worse than no
   * control; a control that is visibly locked, with its reason, is not
   * the same thing (NOTIF-17's argument, applied a level up).
   */
  async list(storeId: string): Promise<readonly StoreCategoryView[]> {
    const rows = await this.prisma.client.storeNotificationPreference.findMany({
      where: { storeId },
      select: { category: true, emailEnabled: true, inAppEnabled: true },
    });
    const byCategory = new Map(rows.map((r) => [r.category, r]));

    return CATEGORY_ORDER.map((category) => {
      const topics = STORE_TOPICS.filter((t) => t.category === category);
      const locked = topics.filter((t) => IMMUTABLE_TOPICS.has(t.topic));
      const row = byCategory.get(category);
      return {
        category,
        emailEnabled: row?.emailEnabled ?? true,
        inAppEnabled: row?.inAppEnabled ?? true,
        // Nothing in it, or nothing in it that can be silenced.
        mutable: topics.length > locked.length,
        topics: topics.map((t) => t.topic),
        lockedTopics: locked.map((t) => t.topic),
        set: row !== undefined,
      };
    });
  }

  /**
   * The store's own choice for one category.
   *
   * Refused for a category with nothing mutable in it — the switch would
   * be a lie, and letting one be stored is how somebody later reads the
   * row and believes it (`STORE_CATEGORY_NOT_MUTABLE`). Upsert rather
   * than update: an absent row means the default, so the first save is a
   * create and there is no "initialise the rows" step to forget.
   */
  async set(input: {
    readonly storeId: string;
    readonly category: StoreNotificationCategory;
    readonly emailEnabled: boolean;
    readonly inAppEnabled: boolean;
    readonly byStoreUserId: string;
  }): Promise<StoreCategoryView> {
    const topics = STORE_TOPICS.filter((t) => t.category === input.category);
    const locked = topics.filter((t) => IMMUTABLE_TOPICS.has(t.topic));
    if (topics.length === locked.length) {
      throw new StoreCategoryNotMutableError(input.category, locked.length > 0);
    }

    await this.prisma.client.storeNotificationPreference.upsert({
      where: { storeId_category: { storeId: input.storeId, category: input.category } },
      create: {
        storeId: input.storeId,
        category: input.category,
        emailEnabled: input.emailEnabled,
        inAppEnabled: input.inAppEnabled,
        updatedByStoreUserId: input.byStoreUserId,
      },
      update: {
        emailEnabled: input.emailEnabled,
        inAppEnabled: input.inAppEnabled,
        updatedByStoreUserId: input.byStoreUserId,
      },
      select: { id: true },
    });

    return {
      category: input.category,
      emailEnabled: input.emailEnabled,
      inAppEnabled: input.inAppEnabled,
      mutable: true,
      topics: topics.map((t) => t.topic),
      lockedTopics: locked.map((t) => t.topic),
      set: true,
    };
  }
}

/**
 * The order the categories are shown in — the store's own work first,
 * its money second, and the two it hears from us least last.
 */
const CATEGORY_ORDER: readonly StoreNotificationCategory[] = [
  StoreNotificationCategory.ORDER_UPDATES,
  StoreNotificationCategory.MONEY,
  StoreNotificationCategory.SUPPORT,
  StoreNotificationCategory.TERMS,
  StoreNotificationCategory.ANNOUNCEMENTS,
];

/** Raised as a 409 by the controller, with the reason in its message. */
export class StoreCategoryNotMutableError extends Error {
  constructor(
    readonly category: StoreNotificationCategory,
    readonly hasLockedTopics: boolean,
  ) {
    super(
      hasLockedTopics
        ? `Everything in "${category}" is something Skydrop never silences — a decision on ` +
            'something you asked for, money, or a change to one of your orders. There is nothing ' +
            'here to switch off.'
        : `Nothing is sent under "${category}" yet, so there is nothing to switch off.`,
    );
    this.name = 'StoreCategoryNotMutableError';
  }
}

/** The channels a store's own layer can ever govern. */
export const STORE_GOVERNED_CHANNELS: readonly NotificationChannel[] = [
  NotificationChannel.EMAIL,
  NotificationChannel.IN_APP,
];
