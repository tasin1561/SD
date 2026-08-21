import { Injectable, Logger } from '@nestjs/common';
import { ActorType, NotificationRecipientType } from '@skydrop/db';
import type { Page } from 'playwright';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { EmailQueue } from '../../email/queue/email.queue';
import { CourierChannelSettingsService } from '../../courier-escalation/services/courier-channel-settings.service';
import { RaiseTicketModal } from '../pages/raise-ticket.modal';

/**
 * Labels whose category must never be actioned unattended.
 *
 * Matched at FETCH time only, to derive the `isHumanOnly` flag once. From
 * then on the flag is what everything reads — so a later re-wording of
 * Delhivery's label cannot unlock a category, which is precisely the
 * failure a label-matching lock would have.
 *
 * Deliberately loose: "claim" catches "Claims / Finance", "Claims and
 * Finance", "Finance Claim". A false positive locks a category that did
 * not need locking, which costs an operator one manual action. A false
 * negative unlocks Claims/Finance.
 */
const HUMAN_ONLY_LABEL_PATTERNS: readonly RegExp[] = [
  /claim/i,
  /finance/i,
  /protect\s*vas/i,
  /\bvas\b/i,
];

export interface TaxonomyFetchResult {
  readonly fetched: number;
  readonly created: number;
  readonly changed: number;
  readonly humanOnly: number;
  readonly disappeared: readonly string[];
  readonly ids: readonly { id: string; label: string; humanOnly: boolean }[];
}

/**
 * Read Delhivery's category tree and persist it, keyed on their IDs.
 *
 * ── THIS IS WHY PHASE 5 UNBLOCKS THE LOCKS ───────────────────────────
 * The Claims/Finance and Protect VAS locks were specified to be enforced
 * by category ID, and until now that was impossible: we had no IDs. So
 * `assertAutoCategoriesAllowed` refused ANY non-empty auto list — an
 * honest substitute, but a blunt one that also blocked the eight
 * categories that could safely have been automated.
 *
 * The portal is the first channel that can READ the taxonomy. Once this
 * has run, `HUMAN_ONLY_CATEGORY_IDS` stops being an empty array in source
 * and becomes a query, and the blanket refusal narrows to the two
 * categories it was always meant to be about.
 *
 * ── A DISAPPEARING CATEGORY IS NOT DELETED ───────────────────────────
 * Rows are upserted and `lastSeenAt` is stamped; nothing is removed. A
 * category that stops appearing is reported as `disappeared` with its
 * stale timestamp intact. Deleting it would silently drop a lock — and
 * "the row is gone" reads identically to "we never knew about it".
 *
 * ── NIGHTLY DIFF, ALERT ON CHANGE ────────────────────────────────────
 * A new category is a thing nobody has decided about, which means it is
 * not on the auto list and cannot be — but somebody should know it
 * exists, because it may be the one their sellers now need.
 */
@Injectable()
export class PortalTaxonomyService {
  private readonly logger = new Logger(PortalTaxonomyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: CourierChannelSettingsService,
    private readonly email: EmailQueue,
    private readonly audit: AuditLogService,
  ) {}

  private isHumanOnly(label: string): boolean {
    return HUMAN_ONLY_LABEL_PATTERNS.some((re) => re.test(label));
  }

  /**
   * Fetch and persist. Needs a logged-in page and an AWB, because the
   * offered categories depend on shipment state — so the tree we get is
   * "categories available for THIS parcel", and the union across parcels
   * is the real taxonomy. One AWB is a start, not the whole thing.
   */
  async fetchAndPersist(
    page: Page,
    awbNumber: string,
    courierCode = 'delhivery',
  ): Promise<TaxonomyFetchResult> {
    const modal = new RaiseTicketModal(page);
    await modal.open(awbNumber);
    const offered = await modal.offeredCategoryIds();

    const before = await this.prisma.client.courierIssueCategory.findMany({
      where: { courierCode },
      select: { externalId: true, label: true },
    });
    const beforeIds = new Set(before.map((b) => b.externalId));
    const beforeLabels = new Map(before.map((b) => [b.externalId, b.label]));

    let created = 0;
    let changed = 0;
    const ids: { id: string; label: string; humanOnly: boolean }[] = [];

    for (const o of offered) {
      const humanOnly = this.isHumanOnly(o.label);
      const existed = beforeIds.has(o.id);
      if (!existed) created += 1;
      else if (beforeLabels.get(o.id) !== o.label) changed += 1;

      await this.prisma.client.courierIssueCategory.upsert({
        where: { courierCode_externalId: { courierCode, externalId: o.id } },
        update: {
          label: o.label,
          lastSeenAt: new Date(),
          // STICKY: once human-only, always. A re-worded label must not
          // be able to unlock a category.
          ...(humanOnly ? { isHumanOnly: true } : {}),
        },
        create: { courierCode, externalId: o.id, label: o.label, isHumanOnly: humanOnly },
      });
      ids.push({ id: o.id, label: o.label, humanOnly });
    }

    const seen = new Set(offered.map((o) => o.id));
    const disappeared = [...beforeIds].filter((id) => !seen.has(id));
    const humanOnly = ids.filter((i) => i.humanOnly).length;

    const result: TaxonomyFetchResult = {
      fetched: offered.length,
      created,
      changed,
      humanOnly,
      disappeared,
      ids,
    };

    if (created > 0 || changed > 0 || disappeared.length > 0) {
      await this.alertOnChange(result);
    }

    await this.prisma.client.courierPortalRun.create({
      data: {
        kind: 'taxonomy-fetch',
        mode: (await this.settings.get(courierCode)).portalMode,
        // A fetch is a READ, so it runs identically in SHADOW and LIVE —
        // which is what lets the taxonomy be populated before anything is
        // ever executed.
        outcome: offered.length === 0 ? 'FAILED' : 'OK',
        detail:
          offered.length === 0
            ? 'No categories found — selector miss or the modal did not open'
            : `fetched=${offered.length} created=${created} changed=${changed} humanOnly=${humanOnly}`,
      },
    });

    this.logger.log(result, 'Portal taxonomy fetch complete');
    return result;
  }

  private async alertOnChange(r: TaxonomyFetchResult): Promise<void> {
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      action: 'courier.portal.taxonomy_changed',
      entityType: 'courier',
      entityId: null,
      // A new category is something nobody has decided about; a
      // disappeared one may be a lock that just stopped existing.
      severity: 'HIGH',
      metadata: {
        courierCode: 'delhivery',
        fetched: r.fetched,
        created: r.created,
        changed: r.changed,
        disappeared: r.disappeared,
      },
    });

    const to = await this.settings.alertEmailForPortal();
    if (to === '') return;
    try {
      await this.email.enqueue({
        templateCode: 'ops.courier_taxonomy_changed.email',
        recipient: { type: NotificationRecipientType.STAFF, email: to },
        triggerEvent: 'courier.portal.taxonomy_changed',
        variables: {
          created: String(r.created),
          changed: String(r.changed),
          disappeared: r.disappeared.join(', ') || 'none',
        },
      });
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Taxonomy-change alert could not be enqueued; the audit row stands',
      );
    }
  }

  /**
   * The human-only category IDs, from the database.
   *
   * This is the query that replaces the empty `HUMAN_ONLY_CATEGORY_IDS`
   * constant. Returns [] before the first fetch, which is exactly why
   * `assertAutoCategoriesAllowed` keys its blanket refusal on emptiness:
   * no IDs means the lock cannot be enforced, so nothing may be
   * automated.
   */
  async humanOnlyCategoryIds(courierCode = 'delhivery'): Promise<string[]> {
    const rows = await this.prisma.client.courierIssueCategory.findMany({
      where: { courierCode, isHumanOnly: true },
      select: { externalId: true },
    });
    return rows.map((r) => r.externalId);
  }
}
