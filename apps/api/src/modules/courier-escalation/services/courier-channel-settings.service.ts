import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ActorType, CourierPortalMode, CourierWriteMode } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';

/**
 * Categories that may NEVER be actioned unattended, whatever anyone sets.
 *
 * ── WHY THESE TWO ────────────────────────────────────────────────────
 * Claims/Finance moves money and creates a commercial position we cannot
 * withdraw. Protect VAS is an insurance product whose filings have terms
 * attached. Both are decisions a person should make on the record.
 *
 * ── WHY THE LIST IS EMPTY AND THAT IS CORRECT ────────────────────────
 * The lock is enforced by Delhivery's category ID, and we have never
 * fetched their taxonomy — the ID is what would go here. So the honest
 * state is: the lock cannot be enforced by ID yet, and therefore the auto
 * list must stay empty, which makes the lock moot rather than absent.
 * `assertAutoCategoriesAllowed` refuses ANY non-empty auto list until
 * the taxonomy has been fetched, which is a stronger guarantee than a
 * lock list with nothing in it.
 *
 * TODO(delhivery-api): populate with the real category IDs once
 * `getTaxonomy()` runs, and relax the blanket refusal to this list.
 */
/**
 * Superseded by `courier_issue_categories.is_human_only` (Phase 5).
 *
 * Kept as an empty array only so nothing that imported it breaks: the
 * authoritative answer is now a QUERY, because the IDs come from
 * Delhivery's own taxonomy and a hard-coded list would have to be edited
 * every time they add a category. See `humanOnlyCategoryIds()`.
 */
export const HUMAN_ONLY_CATEGORY_IDS: readonly string[] = [];

/** Their labels, for the console. Display only — never matched on. */
export const HUMAN_ONLY_CATEGORY_LABELS: readonly string[] = ['Claims / Finance', 'Protect VAS'];

export interface ChannelSettingsView {
  readonly courierCode: string;
  readonly writeMode: CourierWriteMode;
  /** How far the PORTAL channel may go. Separate from writeMode. */
  readonly portalMode: CourierPortalMode;
  readonly autoCategories: readonly string[];
  readonly pausedUntil: Date | null;
  readonly pauseReason: string | null;
  /** Convenience for the console: mode AND health together. */
  readonly effectivelyPaused: boolean;
  readonly updatedByStaffId: string | null;
  readonly updatedAt: Date;
}

/**
 * The write channel's settings, and the rules about changing them.
 *
 * ── MODE AND PAUSE ARE DIFFERENT VARIABLES ───────────────────────────
 * `writeMode` is what the operator CHOSE. `pausedUntil` is what the
 * system concluded about its own health. Storing the pause by flipping
 * the mode to MANUAL would be cheaper and wrong twice over: recovering
 * would have to guess which mode to restore, and an operator who
 * deliberately chose MANUAL would find themselves back in AUTO because a
 * canary went green. Health must never overwrite intent.
 */
@Injectable()
export class CourierChannelSettingsService {
  private readonly logger = new Logger(CourierChannelSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async get(courierCode = 'delhivery'): Promise<ChannelSettingsView> {
    const row = await this.prisma.client.courierChannelSettings.upsert({
      where: { courierCode },
      update: {},
      // Fails CLOSED into existence: an absent row resolves to MANUAL
      // with no auto categories, never to something permissive.
      create: { courierCode, writeMode: CourierWriteMode.MANUAL, autoCategories: [] },
    });
    const paused = row.pausedUntil !== null && row.pausedUntil.getTime() > Date.now();
    return {
      courierCode: row.courierCode,
      writeMode: row.writeMode,
      portalMode: row.portalMode,
      autoCategories: row.autoCategories,
      pausedUntil: row.pausedUntil,
      pauseReason: row.pauseReason,
      effectivelyPaused: paused,
      updatedByStaffId: row.updatedByStaffId,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Where operational alerts go. Empty when unset — the caller decides
   * what that means, and every caller so far treats it as "record the
   * audit row and say the address is missing" rather than inventing one.
   */
  async alertEmailForPortal(): Promise<string> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: 'ops.alert_email' },
      select: { valueString: true },
    });
    return (row?.valueString ?? '').trim();
  }

  /**
   * May the PORTAL execute for real, or is it shadowing?
   *
   * Deliberately separate from `mayAutoAct`: an item can be permitted by
   * write mode and still be shadow-only, which is the whole rollout path.
   */
  async portalMayExecute(courierCode = 'delhivery'): Promise<boolean> {
    const s = await this.get(courierCode);
    if (s.effectivelyPaused) return false;
    return s.portalMode === CourierPortalMode.LIVE;
  }

  /**
   * May the worker act unattended on this item, right now?
   *
   * Read at PICKUP time, never at enqueue: an item queued under AUTO and
   * claimed after someone switched to MANUAL must obey MANUAL. Stamping
   * the decision at enqueue would leave a backlog executing yesterday's
   * intent, and flipping the switch would feel like it had not worked.
   */
  async mayAutoAct(categoryId: string | null, courierCode = 'delhivery'): Promise<boolean> {
    const s = await this.get(courierCode);
    if (s.effectivelyPaused) return false;
    if (s.writeMode !== CourierWriteMode.AUTO) return false;
    if (categoryId === null) return false;
    // The lock is re-checked HERE as well as at write time: a category
    // could be flagged human-only by a taxonomy re-fetch after it was
    // added to the auto list, and the later fact must win.
    if ((await this.humanOnlyCategoryIds(courierCode)).includes(categoryId)) return false;
    return s.autoCategories.includes(categoryId);
  }

  /**
   * Validate a proposed auto list.
   *
   * Refuses ANY non-empty list while the taxonomy is unfetched. That is
   * deliberately blunter than "reject the two locked IDs": we do not
   * know the locked IDs, so we cannot tell whether a supplied string IS
   * one of them. Accepting an unverifiable list would mean the lock
   * exists only in a comment.
   */
  async assertAutoCategoriesAllowed(
    categories: readonly string[],
    courierCode = 'delhivery',
  ): Promise<void> {
    if (categories.length === 0) return;

    const known = await this.prisma.client.courierIssueCategory.findMany({
      where: { courierCode },
      select: { externalId: true, label: true, isHumanOnly: true },
    });

    // Still the blanket refusal, but now on the honest condition: an
    // EMPTY taxonomy, not an empty hard-coded list. Before Phase 5 this
    // was permanent; now it clears itself the first time the portal
    // fetches the tree.
    if (known.length === 0) {
      throw new BadRequestException({
        code: 'TAXONOMY_NOT_FETCHED',
        message:
          'Auto categories cannot be set yet: Delhivery’s category taxonomy has never been fetched, ' +
          'so the Claims/Finance and Protect VAS locks cannot be enforced by ID. ' +
          'Run the portal taxonomy fetch first — it is a READ and runs in SHADOW mode.',
      });
    }

    const byId = new Map(known.map((k) => [k.externalId, k]));

    // An ID we have never seen is refused. Not pedantry: the lock is a
    // property of a category we know about, so an unknown ID is one we
    // cannot say ISN'T Claims/Finance.
    const unknown = categories.filter((c) => !byId.has(c));
    if (unknown.length > 0) {
      throw new BadRequestException({
        code: 'CATEGORY_UNKNOWN',
        message:
          `Not in Delhivery’s fetched taxonomy: ${unknown.join(', ')}. ` +
          'An unknown category cannot be shown to be safe, so it cannot be automated.',
      });
    }

    const locked = categories.filter((c) => byId.get(c)?.isHumanOnly === true);
    if (locked.length > 0) {
      const labels = locked.map((c) => `${c} (${byId.get(c)?.label ?? '?'})`);
      throw new BadRequestException({
        code: 'CATEGORY_IS_HUMAN_ONLY',
        message:
          `These categories can never be actioned unattended: ${labels.join(', ')}. ` +
          'Claims/Finance and Protect VAS are human-only by design.',
      });
    }
  }

  /** The human-only IDs, from the taxonomy. [] before the first fetch. */
  async humanOnlyCategoryIds(courierCode = 'delhivery'): Promise<string[]> {
    const rows = await this.prisma.client.courierIssueCategory.findMany({
      where: { courierCode, isHumanOnly: true },
      select: { externalId: true },
    });
    return rows.map((r) => r.externalId);
  }

  /**
   * Apply a mode change. Called ONLY after the 2FA challenge is
   * confirmed — this method does not decide who may call it.
   */
  async applyMode(input: {
    courierCode: string;
    writeMode: CourierWriteMode;
    autoCategories: readonly string[];
    staffId: string;
    reason: string;
  }): Promise<ChannelSettingsView> {
    await this.assertAutoCategoriesAllowed(input.autoCategories, input.courierCode);
    const before = await this.get(input.courierCode);

    await this.prisma.client.courierChannelSettings.update({
      where: { courierCode: input.courierCode },
      data: {
        writeMode: input.writeMode,
        autoCategories: [...input.autoCategories],
        updatedByStaffId: input.staffId,
      },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: input.staffId,
      actorId: input.staffId,
      action: 'courier.channel.write_mode_changed',
      entityType: 'courier',
      entityId: input.courierCode,
      // Widening the write channel is what lets software post into a
      // customer-visible thread. HIGH, always.
      severity: 'HIGH',
      metadata: {
        from: before.writeMode,
        to: input.writeMode,
        autoCategoriesBefore: before.autoCategories,
        autoCategoriesAfter: input.autoCategories,
        reason: input.reason,
      },
    });

    return this.get(input.courierCode);
  }

  /**
   * Pause the channel for health reasons. Does NOT touch `writeMode`.
   *
   * Callable by the system (a canary failure, an open circuit) and by an
   * operator wanting a big red button. Both leave the chosen mode intact
   * so recovery restores what was actually chosen.
   */
  async pause(input: {
    courierCode?: string;
    until: Date;
    reason: string;
    staffId?: string | null;
  }): Promise<ChannelSettingsView> {
    const courierCode = input.courierCode ?? 'delhivery';
    await this.get(courierCode); // ensure the row exists
    await this.prisma.client.courierChannelSettings.update({
      where: { courierCode },
      data: { pausedUntil: input.until, pauseReason: input.reason },
    });

    await this.audit.log({
      actorType: input.staffId == null ? ActorType.SYSTEM : ActorType.STAFF,
      staffUserId: input.staffId ?? null,
      actorId: input.staffId ?? null,
      action: 'courier.channel.paused',
      entityType: 'courier',
      entityId: courierCode,
      severity: 'HIGH',
      metadata: { until: input.until.toISOString(), reason: input.reason },
    });
    this.logger.warn(
      { courierCode, until: input.until, reason: input.reason },
      'Courier write channel paused',
    );
    return this.get(courierCode);
  }

  /** Clear a pause. The mode is untouched, so this restores what was chosen. */
  async resume(input: { courierCode?: string; staffId: string }): Promise<ChannelSettingsView> {
    const courierCode = input.courierCode ?? 'delhivery';
    await this.get(courierCode);
    await this.prisma.client.courierChannelSettings.update({
      where: { courierCode },
      data: { pausedUntil: null, pauseReason: null },
    });
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: input.staffId,
      actorId: input.staffId,
      action: 'courier.channel.resumed',
      entityType: 'courier',
      entityId: courierCode,
      severity: 'MEDIUM',
      metadata: {},
    });
    return this.get(courierCode);
  }
}
