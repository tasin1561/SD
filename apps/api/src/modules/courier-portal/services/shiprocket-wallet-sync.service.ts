import { Injectable, Logger } from '@nestjs/common';
import { ActorType, SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import {
  WalletImportService,
  type WalletImportResult,
} from '../../wallet-ledger/services/wallet-import.service';
import { ShiprocketWalletPage } from '../pages/shiprocket-wallet.page';
import { CourierWalletReconcileService } from './courier-wallet-reconcile.service';
import { raiseLedgerFindings } from './ledger-findings';
import { shiprocketDate } from './shiprocket-portal-probe.service';
import { raiseShiprocketOpenFailure } from './shiprocket-portal-failures';
import {
  ShiprocketPortalSessionService,
  type ShiprocketPortalHandle,
} from './shiprocket-portal-session.service';
import {
  ledgerCoverage,
  pairCodTopUps,
  paiseToInr,
  parseLedgerRows,
  parsePassbook,
  parseRechargeHistory,
  type LedgerCoverage,
  type PassbookCredit,
} from './shiprocket-wallet-rows';

const DAY_MS = 24 * 60 * 60 * 1000;

export const ACTION_SR_WALLET_OK = 'courier.shiprocket_wallet.synced';
export const ACTION_SR_WALLET_FAILED = 'courier.shiprocket_wallet.sync_failed';
export const SETTING_SR_WALLET_ENABLED = 'courier.shiprocket_wallet_sync_enabled';
export const SETTING_SR_WALLET_WRITES = 'courier.shiprocket_wallet_sync_writes_enabled';
export const SETTING_SR_WALLET_WINDOW = 'courier.shiprocket_wallet_sync_window_days';

export type ShiprocketWalletOutcome =
  | 'READ'
  | 'REFUSED'
  | 'SKIPPED'
  | 'CHALLENGE'
  | 'NO_LOGIN'
  | 'FAILED';

export interface ShiprocketWalletAccountResult {
  readonly courierAccountId: string;
  readonly label: string;
  readonly outcome: ShiprocketWalletOutcome;
  readonly detail: string | null;
  readonly passbookRows: number;
  readonly chainBreaks: number;
  /** Their "Current Usable Balance" tile, and the newest passbook row's balance. */
  readonly usableBalanceInr: string | null;
  readonly newestBalanceInr: string | null;
  readonly import: WalletImportResult | null;
  readonly recharges: {
    readonly seen: number;
    readonly newlySeen: number;
    readonly matched: number;
    readonly unrecorded: number;
    readonly amountMismatched: number;
    readonly lowBalance: number;
  } | null;
  readonly ledger: LedgerCoverage | null;
}

export interface ShiprocketWalletSyncSummary {
  readonly ranAt: string;
  readonly trigger: 'SCHEDULE' | 'MANUAL';
  readonly skipped: 'DISABLED' | 'NO_ACCOUNTS' | null;
  readonly wrote: boolean;
  readonly windowDays: number;
  readonly accounts: readonly ShiprocketWalletAccountResult[];
}

const blank = (
  account: { id: string; label: string },
  outcome: ShiprocketWalletOutcome,
  detail: string | null,
): ShiprocketWalletAccountResult => ({
  courierAccountId: account.id,
  label: account.label,
  outcome,
  detail,
  passbookRows: 0,
  chainBreaks: 0,
  usableBalanceInr: null,
  newestBalanceInr: null,
  import: null,
  recharges: null,
  ledger: null,
});

/**
 * Shiprocket's wallet, read nightly off their panel — the Delhivery wallet
 * sync, for the courier that has no statement API.
 *
 * ── WHY THEIR PANEL ──────────────────────────────────────────────────
 * Their statement API answers with nothing (measured across every
 * filter). Their Passbook lists every wallet movement with the balance
 * after it; their Recharge History lists every top-up with the bank's
 * reference. Both exist only in the panel, which is India-only — hence
 * the Bangalore tunnel the session goes out through.
 *
 * ── ONE SOURCE OF COST ───────────────────────────────────────────────
 * The passbook is netted through the SAME importer as Delhivery's file
 * (COST-1): stored once, netted per parcel from our own ledger, never a
 * negative cost, before→after on every change. It is the only writer of
 * a Shiprocket parcel's cost; the API sync's final `billing_amount` is
 * checked against it rather than written beside it.
 *
 * ── A BROKEN CHAIN IMPORTS NOTHING ───────────────────────────────────
 * Every passbook row's balance is the one before plus its amount. On 90
 * days of real rows that held for all 7,138. So a break means a row was
 * dropped or misread between two we did read — and a ledger with a hole
 * in it would net some parcel too low without anything to show it. The
 * night is REFUSED instead: nothing stored, a person told. Tomorrow's
 * read tries again.
 *
 * ── A CHALLENGE STOPS EVERY BROWSER RUN ──────────────────────────────
 * The same issue key as the website probe, so an OTP or captcha raised
 * by either stops both until a person clears it.
 */
@Injectable()
export class ShiprocketWalletSyncService {
  private readonly logger = new Logger(ShiprocketWalletSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly session: ShiprocketPortalSessionService,
    private readonly importer: WalletImportService,
    private readonly reconcile: CourierWalletReconcileService,
    private readonly audit: AuditLogService,
    private readonly issues: SystemIssueService,
  ) {}

  async sync(
    trigger: 'SCHEDULE' | 'MANUAL',
    now: Date = new Date(),
  ): Promise<ShiprocketWalletSyncSummary> {
    const [enabled, writes, windowDays] = await Promise.all([
      this.flag(SETTING_SR_WALLET_ENABLED),
      this.flag(SETTING_SR_WALLET_WRITES),
      this.int(SETTING_SR_WALLET_WINDOW, 90),
    ]);
    const base = { ranAt: now.toISOString(), trigger, wrote: writes, windowDays };
    if (!enabled) {
      return this.finish({ ...base, skipped: 'DISABLED', wrote: false, accounts: [] });
    }

    const accounts = await this.prisma.client.courierAccount.findMany({
      where: { courier: { code: 'shiprocket' }, isActive: true, deletedAt: null },
      select: { id: true, label: true },
      orderBy: { createdAt: 'asc' },
    });
    if (accounts.length === 0) {
      return this.finish({ ...base, skipped: 'NO_ACCOUNTS', accounts: [] });
    }

    const results: ShiprocketWalletAccountResult[] = [];
    for (const account of accounts) {
      // One account failing must not cost the others their night.
      results.push(await this.syncAccount(account, now, windowDays, writes));
    }

    // "Money left our bank and never reached a wallet" is one question
    // about OUR book, asked once — and not while only reporting.
    if (writes) {
      try {
        await this.reconcile.checkPaidButNeverArrived();
      } catch (err) {
        this.logger.error({ err: String(err) }, 'Paid-but-never-arrived check failed');
      }
    }
    return this.finish({ ...base, skipped: null, accounts: results });
  }

  private async syncAccount(
    account: { id: string; label: string },
    now: Date,
    windowDays: number,
    writes: boolean,
  ): Promise<ShiprocketWalletAccountResult> {
    const challengeKey = `shiprocket-portal-challenge:${account.id}`;
    const open = await this.prisma.client.systemIssue.findFirst({
      where: { dedupeKey: challengeKey, resolvedAt: null },
      select: { id: true },
    });
    if (open !== null) {
      return blank(account, 'SKIPPED', 'A sign-in challenge is still open for this account.');
    }

    let handle: ShiprocketPortalHandle;
    try {
      handle = await this.session.open(account.id, `wallet-${now.getTime()}`);
    } catch (err) {
      // Shared with the invoice check, so both raise the SAME issues.
      const f = await raiseShiprocketOpenFailure(this.issues, {
        source: 'ShiprocketWalletSyncService',
        account,
        err,
        failureKey: `shiprocket-wallet-sync:${account.id}`,
      });
      return blank(
        account,
        f.outcome,
        f.outcome === 'FAILED' ? f.message.slice(0, 300) : f.message,
      );
    }

    const from = shiprocketDate(new Date(now.getTime() - windowDays * 86_400_000));
    const to = shiprocketDate(now);
    try {
      const { passbookRows, usable, rechargeRows, ledgerRows } = await this.readWallet(
        handle,
        from,
        to,
      );

      const pb = parsePassbook(passbookRows);
      const chainKey = `shiprocket-wallet-chain:${account.id}`;
      if (pb.chainBreaks.length > 0) {
        await this.issues.raise({
          kind: SystemIssueKind.MONEY,
          severity: SystemIssueSeverity.HIGH,
          title: `${account.label}'s passbook does not add up — nothing imported`,
          detail:
            `Each passbook row's balance should be the one before it plus its amount. At ` +
            `${pb.chainBreaks.length} point(s) it is not, so a movement was dropped or misread ` +
            'between two rows we did read. Importing a ledger with a hole in it would net some ' +
            "parcel too low with nothing to show it, so tonight's read was not stored.\n\n" +
            pb.chainBreaks
              .slice(0, 10)
              .map(
                (b) =>
                  `${b.at} · ${b.description} · expected ₹${b.expectedInr}, shown ₹${b.foundInr}`,
              )
              .join('\n') +
            '\n\nIt retries tomorrow. If this repeats, their page has changed.',
          source: 'ShiprocketWalletSyncService',
          dedupeKey: chainKey,
          metadata: {
            courierAccountId: account.id,
            breaks: pb.chainBreaks.slice(0, 25).map((b) => ({ ...b })),
          },
        });
        return {
          ...blank(account, 'REFUSED', `${pb.chainBreaks.length} balance-chain break(s)`),
          passbookRows: pb.rowsRead,
          chainBreaks: pb.chainBreaks.length,
          usableBalanceInr: usable,
          newestBalanceInr: pb.newestBalanceInr,
        };
      }
      await this.issues.resolveByKey(chainKey, 'The passbook adds up again.');

      const imported = await this.importer.importTransactions({
        courierCode: 'shiprocket',
        courierAccountId: account.id,
        txns: pb.txns,
        periodFrom: pb.periodFrom,
        periodTo: pb.periodTo,
        rowsRead: pb.rowsRead,
        rowsSkipped: 0,
        sumInr: pb.debitsInr,
        statedTotalInr: null,
        // The chain held across every row read, or we would not be here.
        totalsAgree: true,
        impliedClosingInr: pb.newestBalanceInr,
        dryRun: !writes,
        staffId: null,
      });
      await raiseLedgerFindings(this.issues, {
        courierName: 'Shiprocket',
        source: 'ShiprocketWalletSyncService',
        account,
        result: imported,
      });

      const recharges = parseRechargeHistory(rechargeRows, pb.recharges);
      const matched = writes
        ? await this.reconcile.reconcileRecharges(
            'shiprocket',
            account.id,
            account.label,
            recharges,
            {
              balanceInr: usable ?? pb.newestBalanceInr ?? '0.00',
              totalCreditInr: null,
              totalDebitInr: null,
            },
          )
        : null;

      const ledger = ledgerCoverage(parseLedgerRows(ledgerRows), pb);
      const ledgerKey = `shiprocket-ledger-uncovered:${account.id}`;
      if (ledger.uncovered.length > 0) {
        await this.issues.raise({
          kind: SystemIssueKind.MONEY,
          severity: SystemIssueSeverity.MEDIUM,
          title: `${ledger.uncovered.length} credit(s) in ${account.label}'s Shiprocket ledger never reached the wallet`,
          detail:
            'Their Ledger (the accounting view) lists these credits, and no Passbook movement ' +
            'of the same amount appears within a few days. The Passbook is what we book, so ' +
            'these are NOT in our figures; ask Shiprocket where they went.\n\n' +
            ledger.uncovered
              .slice(0, 10)
              .map((u) => `${u.date} · ${u.particulars} · ₹${u.amountInr} · ${u.description}`)
              .join('\n'),
          source: 'ShiprocketWalletSyncService',
          dedupeKey: ledgerKey,
          metadata: {
            courierAccountId: account.id,
            uncovered: ledger.uncovered.slice(0, 25).map((u) => ({ ...u })),
          },
        });
      } else {
        await this.issues.resolveByKey(ledgerKey, 'Every ledger credit is in the passbook again.');
      }

      await this.checkCodTopUps(account, pb.codTopUps, now, windowDays);

      await this.issues.resolveByKey(
        `shiprocket-wallet-sync:${account.id}`,
        'The Shiprocket wallet sync completed on its own.',
      );
      return {
        courierAccountId: account.id,
        label: account.label,
        outcome: 'READ',
        detail: null,
        passbookRows: pb.rowsRead,
        chainBreaks: 0,
        usableBalanceInr: usable,
        newestBalanceInr: pb.newestBalanceInr,
        import: imported,
        recharges:
          matched === null
            ? null
            : {
                seen: matched.rechargesSeen,
                newlySeen: matched.newlySeen,
                matched: matched.matched,
                unrecorded: matched.unrecorded,
                amountMismatched: matched.amountMismatched,
                lowBalance: matched.lowBalance,
              },
        ledger,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { courierAccountId: account.id, err: message },
        'Shiprocket wallet sync failed',
      );
      await this.issues.raise({
        kind: SystemIssueKind.COURIER_COST_SYNC,
        severity: SystemIssueSeverity.MEDIUM,
        title: `Could not read ${account.label}'s Shiprocket wallet`,
        detail:
          `The nightly Shiprocket wallet sync failed: ${message.slice(0, 400)}\n\n` +
          'Their parcel costs are not updating and read as uncovered in the P&L — not as ' +
          'free. It retries tonight; if it keeps failing their panel has probably changed.',
        source: 'ShiprocketWalletSyncService',
        dedupeKey: `shiprocket-wallet-sync:${account.id}`,
        metadata: { courierAccountId: account.id, error: message.slice(0, 500) },
      });
      return blank(account, 'FAILED', message.slice(0, 300));
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  /**
   * The three tabs, each in a FRESH tab: a tab their router has redirected
   * can stop painting for good (see the session service). Its own method
   * so the rest of the night can be tested without a browser.
   */
  protected async readWallet(
    handle: ShiprocketPortalHandle,
    from: string,
    to: string,
  ): Promise<{
    passbookRows: string[][];
    usable: string | null;
    rechargeRows: string[][];
    ledgerRows: string[][];
  }> {
    const read = async <T>(fn: (p: ShiprocketWalletPage) => Promise<T>): Promise<T> => {
      const page = await handle.newPage();
      try {
        return await fn(new ShiprocketWalletPage(page));
      } finally {
        await page.close().catch(() => undefined);
      }
    };
    const { passbookRows, usable } = await read(async (p) => ({
      passbookRows: await p.readTab('passbook', from, to),
      usable: await p.readUsableBalance(),
    }));
    const rechargeRows = await read((p) => p.readTab('recharge-history', from, to));
    const ledgerRows = await read((p) => p.readTab('ledger', from, to));
    return { passbookRows, usable, rechargeRows, ledgerRows };
  }

  /**
   * Freight taken from a COD payout (Shiprocket Postpaid) is OUR money
   * moving into the wallet: the payout books it as a top-up, and the
   * passbook shows it as a credit we leave out of the P&L. Both halves
   * must exist. A payout whose top-up never shows up means the credit
   * never arrived — or arrived under wording we did not recognise, in
   * which case it was booked as the courier's credit and the P&L reads
   * our own money as income. A COD-funded credit with no payout means
   * the payout was never recorded.
   */
  private async checkCodTopUps(
    account: { id: string; label: string },
    seen: readonly PassbookCredit[],
    now: Date,
    windowDays: number,
  ): Promise<void> {
    const since = new Date(now.getTime() - windowDays * DAY_MS);
    const claims = await this.prisma.client.courierSettlement.findMany({
      where: {
        courierAccountId: account.id,
        freightDeductedInr: { gt: 0 },
        receivedAt: { gte: since },
      },
      select: { reference: true, freightDeductedInr: true, receivedAt: true },
    });
    const { unseen, unclaimed } = pairCodTopUps(
      claims.map((c) => ({
        reference: c.reference,
        amountPaise: Math.round(Number(c.freightDeductedInr.toFixed(2)) * 100),
        at: c.receivedAt,
      })),
      seen.filter((s) => s.occurredAt.getTime() >= since.getTime()),
    );
    // A payout recorded in the last three days may not have reached their passbook yet.
    const overdue = unseen.filter((u) => now.getTime() - u.at.getTime() > 3 * DAY_MS);

    const unseenKey = `shiprocket-cod-topup-unseen:${account.id}`;
    if (overdue.length > 0) {
      await this.issues.raise({
        kind: SystemIssueKind.MONEY,
        severity: SystemIssueSeverity.MEDIUM,
        title: `${overdue.length} COD payout top-up(s) never showed up in ${account.label}'s Shiprocket wallet`,
        detail:
          'These payouts say Shiprocket moved part of the COD into our wallet (freight from ' +
          'COD), and no wallet credit of that amount appears within 15 days. Either it never ' +
          'arrived — ask Shiprocket — or their passbook worded it in a way we did not recognise, ' +
          "in which case it was booked as the courier's own credit and the P&L reads our money as " +
          'income until this is fixed.\n\n' +
          overdue
            .map(
              (u) =>
                `payout ${u.reference} · ${u.at.toISOString().slice(0, 10)} · ₹${paiseToInr(u.amountPaise)}`,
            )
            .join('\n'),
        source: 'ShiprocketWalletSyncService',
        dedupeKey: unseenKey,
        metadata: {
          courierAccountId: account.id,
          payouts: overdue.map((u) => ({
            reference: u.reference,
            amountInr: paiseToInr(u.amountPaise),
            receivedAt: u.at.toISOString(),
          })),
        },
      });
    } else {
      await this.issues.resolveByKey(unseenKey, 'Every COD payout top-up is in the wallet.');
    }

    const unrecordedKey = `shiprocket-cod-topup-unrecorded:${account.id}`;
    if (unclaimed.length > 0) {
      await this.issues.raise({
        kind: SystemIssueKind.MONEY,
        severity: SystemIssueSeverity.MEDIUM,
        title: `${unclaimed.length} wallet credit(s) in ${account.label} came from a COD payout we have not recorded`,
        detail:
          "Shiprocket's passbook shows part of a COD payout moved into the wallet, and no " +
          'recorded payout says so. Record that payout on /settlements with its freight ' +
          'deduction — until then the bank book is missing the payout (the credit itself is ' +
          'correctly left out of the P&L: it is our own money).\n\n' +
          unclaimed
            .map(
              (c) =>
                `${c.occurredAt.toISOString().slice(0, 10)} · ₹${paiseToInr(c.amountPaise)} · ${c.description.slice(0, 100)}`,
            )
            .join('\n'),
        source: 'ShiprocketWalletSyncService',
        dedupeKey: unrecordedKey,
        metadata: {
          courierAccountId: account.id,
          credits: unclaimed.map((c) => ({
            amountInr: paiseToInr(c.amountPaise),
            occurredAt: c.occurredAt.toISOString(),
            description: c.description.slice(0, 200),
          })),
        },
      });
    } else {
      await this.issues.resolveByKey(
        unrecordedKey,
        'Every COD-funded wallet credit has its payout.',
      );
    }
  }

  private async finish(summary: ShiprocketWalletSyncSummary): Promise<ShiprocketWalletSyncSummary> {
    const failed = summary.accounts.filter((a) => a.outcome !== 'READ').length;
    const allFailed = summary.accounts.length > 0 && failed === summary.accounts.length;
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: allFailed ? ACTION_SR_WALLET_FAILED : ACTION_SR_WALLET_OK,
      entityType: 'courier',
      // A UUID column; the courier code goes in metadata.
      entityId: null,
      severity: failed > 0 ? 'HIGH' : summary.wrote ? 'MEDIUM' : 'LOW',
      metadata: {
        courierCode: 'shiprocket',
        ...summary,
        accounts: summary.accounts.map((a) => ({ ...a })),
      },
    });
    this.logger.log(
      { accounts: summary.accounts.length, failed, wrote: summary.wrote, skipped: summary.skipped },
      'Shiprocket wallet sync done',
    );
    return summary;
  }

  private async flag(key: string): Promise<boolean> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueBoolean: true },
    });
    return row?.valueBoolean === true;
  }

  private async int(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueInt: true },
    });
    return row?.valueInt ?? fallback;
  }
}
