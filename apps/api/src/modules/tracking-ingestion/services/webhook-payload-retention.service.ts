import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Letting go of courier payloads we no longer need.
 *
 * `courier_webhooks` is the single largest table per order, by a wide
 * margin, and nothing has ever deleted from it. Every scan of every
 * parcel writes a row holding the courier's payload up to three times —
 * `headers`, `rawBody` verbatim, and `parsedBody`, which is `rawBody`
 * again after parsing. Ten scans per parcel at a few kilobytes each
 * means an order leaves roughly 40 KB here against perhaps 15 KB for
 * everything else about it combined.
 *
 * ── Why blank the columns instead of deleting the row ────────────────
 * The row is two different things at once. The payload is a debugging
 * artefact: useful while a courier dispute or a parsing bug is live,
 * worthless a quarter later. The row's OTHER fields are evidence — that
 * a scan arrived at this time, that its signature verified, which
 * tracking event it produced. Deleting the row would throw away the
 * evidence to reclaim the artefact.
 *
 * So the row survives at a couple of hundred bytes instead of several
 * thousand, and `tracking_events` — the permanent, customer-visible
 * record this webhook produced — is untouched. Nothing reads these
 * columns after ingest; both are written and never read back, so
 * clearing them cannot affect behaviour.
 *
 * ── Why this is not "archival" ──────────────────────────────────────
 * Nothing is moved anywhere. There is no export, no second store, no
 * retrieval path to maintain, and nothing to back up. The steady-state
 * size of this table becomes bounded by the retention window rather
 * than by how long the company has existed, which is the property that
 * makes an archival system unnecessary rather than merely deferred.
 *
 * NEVER extend this to financial tables. Wallet entries, invoices,
 * charges, settlements and withholdings are the seller's own record of
 * what they were paid and charged, and they stay whole and queryable
 * forever. This service touches one table, deliberately.
 */

/** Matches the seeded value at `tracking.webhook_payload_retention_days`. */
const SETTING_KEY = 'tracking.webhook_payload_retention_days';
const DEFAULT_RETENTION_DAYS = 90;

/** Rows per pass. Bounded so one sweep cannot lock the table for long
 *  or build a transaction big enough to matter on the money path. */
const BATCH_SIZE = 1_000;
const MAX_BATCHES_PER_RUN = 50;

export interface RetentionSweepResult {
  readonly retentionDays: number;
  readonly cutoff: Date;
  readonly rowsCleared: number;
  /** True when we hit the per-run cap and more remain for next time. */
  readonly moreRemaining: boolean;
}

@Injectable()
export class WebhookPayloadRetentionService {
  private readonly logger = new Logger(WebhookPayloadRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sweep(): Promise<RetentionSweepResult> {
    const retentionDays = await this.retentionDays();
    const cutoff = new Date(Date.now() - retentionDays * 864e5);

    let rowsCleared = 0;
    let moreRemaining = false;

    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
      // Select then update, so each pass is bounded — `updateMany` has
      // no LIMIT, and an unbounded UPDATE over a year of webhooks is
      // exactly the kind of statement that takes the table with it.
      //
      // `rawBody: { not: '' }` is what makes this idempotent: an
      // already-cleared row is not selected again, so a re-run costs one
      // empty query rather than rewriting history.
      const rows = await this.prisma.client.courierWebhook.findMany({
        where: { receivedAt: { lt: cutoff }, rawBody: { not: '' } },
        select: { id: true },
        take: BATCH_SIZE,
      });
      if (rows.length === 0) break;

      await this.prisma.client.courierWebhook.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: {
          rawBody: '',
          headers: {},
          parsedBody: Prisma.DbNull,
          // The stack trace of a failure this old is not going to be
          // read either, and it is the other free-text column here.
          errorStack: null,
        },
      });
      rowsCleared += rows.length;

      if (batch === MAX_BATCHES_PER_RUN - 1 && rows.length === BATCH_SIZE) {
        moreRemaining = true;
      }
    }

    if (rowsCleared > 0) {
      this.logger.log(
        { retentionDays, rowsCleared, moreRemaining },
        'Cleared courier webhook payloads past their retention window',
      );
    }
    return { retentionDays, cutoff, rowsCleared, moreRemaining };
  }

  /** How much of the table is still carrying a payload — the number the
   *  capacity page reports, and the one that shows the sweep working. */
  async pendingCount(): Promise<{ retained: number; retentionDays: number }> {
    const retentionDays = await this.retentionDays();
    const retained = await this.prisma.client.courierWebhook.count({
      where: { rawBody: { not: '' } },
    });
    return { retained, retentionDays };
  }

  private async retentionDays(): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: SETTING_KEY },
      select: { valueInt: true },
    });
    // Fails open to the seeded default. A settings outage should not
    // silently stop reclaiming space, nor delete more than intended.
    return row?.valueInt ?? DEFAULT_RETENTION_DAYS;
  }
}
