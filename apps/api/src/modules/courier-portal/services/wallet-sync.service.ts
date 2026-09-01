import { Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { WalletLedgerFetcherService } from './wallet-ledger-fetcher.service';
import {
  WalletImportService,
  type WalletImportResult,
} from '../../wallet-ledger/services/wallet-import.service';

const SETTING_ENABLED = 'courier.wallet_sync_enabled';
const SETTING_WRITE = 'courier.wallet_sync_writes_enabled';
const SETTING_WINDOW_DAYS = 'courier.wallet_sync_window_days';

/** One account's fetch. Several Delhivery accounts means several. */
export interface WalletSyncAccountResult {
  readonly courierAccountId: string;
  readonly label: string;
  readonly fileBytes: number | null;
  readonly result: WalletImportResult | null;
  readonly error: string | null;
}

export interface WalletSyncSummary {
  readonly ranAt: string;
  readonly skipped: 'DISABLED' | 'NO_ACCOUNTS' | null;
  /** False while the sync only reports. See the class comment. */
  readonly wrote: boolean;
  readonly windowDays: number;
  readonly accounts: readonly WalletSyncAccountResult[];
}

/**
 * Fetching the wallet ledger by itself, nightly.
 *
 * ── WHY A BROWSER ────────────────────────────────────────────────────
 * Delhivery has no billing API. Their documented surface offers a cost
 * CALCULATOR — "what does a parcel of this shape cost" — which can
 * never answer "what was this one billed", and cannot see a revision.
 * The wallet ledger is the only record of what actually left, and it
 * exists only in their panel.
 *
 * ── A ROLLING WINDOW, NOT YESTERDAY ──────────────────────────────────
 * A charge is re-cut weeks after the parcel moved. Fetching only the
 * last day would import each parcel's FIRST figure and never see the
 * correction, which is the exact error the whole importer exists to
 * avoid. So it re-fetches a wide window every night and re-states it.
 * That is cheap because the importer overwrites rather than skips.
 *
 * ── SHADOW BY DEFAULT, AND THE TWO SWITCHES ARE SEPARATE ─────────────
 * `wallet_sync_enabled` runs it; `wallet_sync_writes_enabled` lets it
 * touch the cost columns. Two switches rather than one so the fetch and
 * the parse can be proven against real files for a week while writing
 * nothing — the same shape the portal work already uses, and the reason
 * a login or a page change shows up as a report rather than as wrong
 * money in the P&L.
 */
@Injectable()
export class WalletSyncService {
  private readonly logger = new Logger(WalletSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fetcher: WalletLedgerFetcherService,
    private readonly importer: WalletImportService,
    private readonly audit: AuditLogService,
  ) {}

  async sync(now: Date = new Date()): Promise<WalletSyncSummary> {
    const [enabled, writes, windowDays] = await Promise.all([
      this.flag(SETTING_ENABLED, false),
      this.flag(SETTING_WRITE, false),
      this.int(SETTING_WINDOW_DAYS, 45),
    ]);

    const base = {
      ranAt: now.toISOString(),
      wrote: writes,
      windowDays,
      accounts: [] as WalletSyncAccountResult[],
    };
    if (!enabled) return { ...base, skipped: 'DISABLED' as const, wrote: false };

    // EVERY active Delhivery account, because each is a different
    // company on their panel with its own wallet. One login cannot see
    // another's money.
    const accounts = await this.prisma.client.courierAccount.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        courier: { code: 'delhivery' },
        credential: { isNot: null },
      },
      select: { id: true, label: true },
      orderBy: { label: 'asc' },
    });
    if (accounts.length === 0) return { ...base, skipped: 'NO_ACCOUNTS' as const };

    const from = new Date(now.getTime() - windowDays * 86_400_000);
    const results: WalletSyncAccountResult[] = [];

    for (const account of accounts) {
      try {
        const file = await this.fetcher.fetch(account.id, from, now);
        // dryRun is the inverse of the write switch: in SHADOW it parses
        // the real file and reports exactly what it WOULD change.
        const result = await this.importer.importDelhiveryWallet(file, null, {
          dryRun: !writes,
          // Scoped, so one account's ledger cannot claim another's
          // parcels and "not ours" keeps meaning something.
          courierAccountId: account.id,
        });
        results.push({
          courierAccountId: account.id,
          label: account.label,
          fileBytes: file.length,
          result,
          error: null,
        });
      } catch (err) {
        // One account's portal being down must not stop the others —
        // the same per-item failure isolation as the AWB and manifest
        // sagas. Its costs are simply re-read tomorrow.
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          { err: message, courierAccountId: account.id, label: account.label },
          'Wallet ledger sync failed for one account; continuing with the rest',
        );
        results.push({
          courierAccountId: account.id,
          label: account.label,
          fileBytes: null,
          result: null,
          error: message,
        });
      }
    }

    const summary: WalletSyncSummary = { ...base, skipped: null, accounts: results };
    const failed = results.filter((r) => r.error !== null).length;
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      actorId: null,
      action:
        failed === results.length
          ? 'courier.wallet_ledger.sync_failed'
          : 'courier.wallet_ledger.synced',
      entityType: 'courier',
      // A UUID column. The code goes in metadata (see the importer).
      entityId: null,
      severity: failed > 0 ? 'HIGH' : writes ? 'MEDIUM' : 'LOW',
      metadata: { courierCode: 'delhivery', ...summary, accounts: results.map((r) => ({ ...r })) },
    });
    this.logger.log({ accounts: results.length, failed, wrote: writes }, 'Wallet ledger sync done');
    return summary;
  }

  private async flag(key: string, fallback: boolean): Promise<boolean> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueBoolean: true },
    });
    return row?.valueBoolean ?? fallback;
  }

  private async int(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueInt: true },
    });
    return row?.valueInt ?? fallback;
  }
}
