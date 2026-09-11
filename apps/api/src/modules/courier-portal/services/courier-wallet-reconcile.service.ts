import { Injectable, Logger } from '@nestjs/common';
import {
  BankEntryType,
  CourierRechargeMatch,
  Prisma,
  SystemIssueKind,
  SystemIssueSeverity,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { PortalSessionService } from './portal-session.service';
import { WalletRechargesPage } from '../pages/wallet-recharges.page';

export interface WalletReconcileResult {
  readonly accounts: number;
  readonly rechargesSeen: number;
  readonly newlySeen: number;
  readonly matched: number;
  readonly unrecorded: number;
  readonly amountMismatched: number;
  readonly paidButNeverArrived: number;
  readonly lowBalance: number;
}

const LOW_BALANCE_KEY = 'courier.delhivery_wallet_low_balance_inr';
const DEFAULT_LOW_BALANCE = '10000';
/**
 * How far the page's stated window debit may sit from the export's sum
 * before it means something.
 *
 * Their page rounds for display and the file does not: every capture so
 * far differs by exactly one paisa. A rupee is comfortably above that
 * and far below any missing row — the smallest real charge on this
 * account is an order of magnitude larger.
 */
const ROUNDING_TOLERANCE_INR = 1;

/**
 * Does every rupee in the courier's wallet match a rupee that left ours?
 *
 * ── THE EXPOSURE ─────────────────────────────────────────────────────
 * Delhivery's wallet is PREPAID. We send money, they issue waybills
 * against it. That means a standing balance of our capital sits on
 * somebody else's system, funded by bank payments nobody was checking.
 *
 * Three things can go wrong, and they are not symmetric:
 *
 *   MONEY LEFT AND NEVER ARRIVED — a bank entry says we recharged, and
 *   no recharge exists at the courier. This is the SCAM SHAPE: it is
 *   what taking money out of the treasury under a plausible label looks
 *   like, and its only other symptom is a wallet that empties sooner
 *   than the books say it should — noticed months later, if at all.
 *   CRITICAL.
 *
 *   MONEY ARRIVED THAT WE DID NOT SEND — a recharge at the courier with
 *   nothing in our books. Either somebody forgot the entry or somebody
 *   else's money funded it. Both need a person, and the second is the
 *   one worth knowing about. HIGH.
 *
 *   THE AMOUNTS DISAGREE — the two are linked and the figures differ.
 *   Money went somewhere between the account and the wallet. CRITICAL.
 *
 * ── AND A FOURTH THE PER-ROW CHECKS CANNOT SEE ───────────────────────
 * Their stated balance is compared against their own credits minus
 * debits. If those disagree, something is missing from the list they
 * showed us — and a reconciliation that only ever reads a list cannot
 * notice the list is short.
 *
 * ── MATCHING IS BY THE BANK'S OWN REFERENCE ──────────────────────────
 * Their recharge row carries the BANK's transaction id. Matching on
 * amount and date would pair two ₹20,000 recharges made on the same
 * morning arbitrarily and report both as reconciled, which is worse than
 * not matching at all — it produces a clean report over a real gap.
 */
@Injectable()
export class CourierWalletReconcileService {
  private readonly logger = new Logger(CourierWalletReconcileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly session: PortalSessionService,
    private readonly issues: SystemIssueService,
  ) {}

  async reconcile(
    courierCode = 'delhivery',
    /**
     * What each account's wallet export summed to on THIS run, keyed by
     * account id.
     *
     * Passed in rather than re-read: the import has just done the work,
     * and downloading the file a second time to check it against the
     * page would be a second live request for a number we are holding.
     * Absent when the reconcile runs on its own, and the check simply
     * does not run — a missing input is not a finding.
     */
    exportSums?: ReadonlyMap<string, string>,
  ): Promise<WalletReconcileResult> {
    const accounts = await this.prisma.client.courierAccount.findMany({
      where: { courier: { code: courierCode }, deletedAt: null },
      select: { id: true, label: true },
      orderBy: { createdAt: 'asc' },
    });

    const result = {
      accounts: accounts.length,
      rechargesSeen: 0,
      newlySeen: 0,
      matched: 0,
      unrecorded: 0,
      amountMismatched: 0,
      paidButNeverArrived: 0,
      lowBalance: 0,
    };

    for (const account of accounts) {
      try {
        const one = await this.reconcileAccount(
          account.id,
          account.label,
          exportSums?.get(account.id),
        );
        result.rechargesSeen += one.rechargesSeen;
        result.newlySeen += one.newlySeen;
        result.matched += one.matched;
        result.unrecorded += one.unrecorded;
        result.amountMismatched += one.amountMismatched;
        result.lowBalance += one.lowBalance;
      } catch (err) {
        // One account's failure must not cost the others their check —
        // the same per-item isolation as the AWB fan-out.
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error({ accountId: account.id, err: message }, 'Wallet reconcile failed');
        await this.issues.raise({
          kind: SystemIssueKind.MONEY,
          severity: SystemIssueSeverity.HIGH,
          title: `Could not reconcile the ${account.label} wallet`,
          detail:
            `Reading the courier's wallet and recharge list failed: ${message}\n\n` +
            'While this persists nothing is checking that money leaving our bank actually ' +
            'reaches their wallet, or that every recharge there was paid for by us.',
          source: 'CourierWalletReconcileService',
          dedupeKey: `courier-wallet-reconcile-down:${account.id}`,
          metadata: { courierAccountId: account.id, error: message },
        });
      }
    }

    /*
      Once per run, NOT once per account.

      A bank entry does not say which wallet it funded — the reference
      is what ties it to a recharge — so asking this question inside the
      per-account loop would ask it N times over the same rows and
      answer with whichever account happened to be iterating. It is a
      question about OUR ledger, and it has one answer.

      It also runs even when every account's read FAILED: "money left
      and nothing on their side matches it" is exactly the finding that
      must not depend on the portal being reachable.
    */
    result.paidButNeverArrived = await this.findPaidButNeverArrived();

    return result;
  }

  private async reconcileAccount(
    accountId: string,
    label: string,
    exportSumInr?: string,
  ): Promise<Omit<WalletReconcileResult, 'accounts' | 'paidButNeverArrived'>> {
    const page = await this.session.page(accountId);
    const portal = new WalletRechargesPage(page);
    try {
      const balance = await portal.readBalance();
      const recharges = await portal.listRecharges();

      let newlySeen = 0;
      let matched = 0;
      let unrecorded = 0;
      let amountMismatched = 0;

      for (const r of recharges) {
        const existing = await this.prisma.client.courierWalletRecharge.findUnique({
          where: {
            courierAccountId_externalTxnId: {
              courierAccountId: accountId,
              externalTxnId: r.externalTxnId,
            },
          },
          select: { id: true, bankEntryId: true, matchState: true },
        });
        if (existing === null) newlySeen += 1;

        // Their id is the dedup key, so a nightly re-read RESTATES a
        // recharge rather than recording a second one.
        const row = await this.prisma.client.courierWalletRecharge.upsert({
          where: {
            courierAccountId_externalTxnId: {
              courierAccountId: accountId,
              externalTxnId: r.externalTxnId,
            },
          },
          create: {
            courierAccountId: accountId,
            externalTxnId: r.externalTxnId,
            bankTxnRef: r.bankTxnRef,
            amountInr: new Prisma.Decimal(r.amountInr),
            status: r.status,
            occurredAt: r.occurredAt,
          },
          // The amount and their reference are restated; the MATCH is
          // not touched here — a resolution is a person's judgement and
          // must not be undone by a sweep.
          update: {
            bankTxnRef: r.bankTxnRef,
            amountInr: new Prisma.Decimal(r.amountInr),
            status: r.status,
            occurredAt: r.occurredAt,
            lastSeenAt: new Date(),
          },
          select: { id: true, bankEntryId: true, matchState: true, amountInr: true },
        });

        const state = await this.matchOne(row.id, accountId, r, row.bankEntryId, row.matchState);
        if (state === CourierRechargeMatch.MATCHED) matched += 1;
        else if (state === CourierRechargeMatch.AMOUNT_MISMATCH) amountMismatched += 1;
        else if (state === CourierRechargeMatch.UNRECORDED) unrecorded += 1;
      }

      /*
        The balance leg is the LEAST load-bearing of the three and must
        not be able to erase the two that already succeeded. A failure
        here used to propagate to the per-account catch, which reports
        "nothing is checking that money leaving our bank reaches their
        wallet" — a statement that would be false, since the matching
        above had just run. Found by a test whose fake was missing a
        method, which is exactly the shape a real late failure takes.
      */
      let lowBalance = 0;
      try {
        lowBalance = await this.checkBalance(accountId, label, balance, exportSumInr);
      } catch (err) {
        this.logger.error(
          { accountId, err: err instanceof Error ? err.message : String(err) },
          'Wallet balance check failed; the recharge reconciliation still stands',
        );
      }

      return {
        rechargesSeen: recharges.length,
        newlySeen,
        matched,
        unrecorded,
        amountMismatched,
        lowBalance,
      };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /**
   * Tie one recharge to our own bank entry, by the BANK's reference.
   *
   * A resolved row is left alone: somebody looked and said what it was,
   * and a sweep must not overwrite that. An already-linked row is only
   * re-checked for the amounts agreeing.
   */
  private async matchOne(
    rechargeId: string,
    accountId: string,
    r: { bankTxnRef: string | null; amountInr: string; externalTxnId: string },
    bankEntryId: string | null,
    current: CourierRechargeMatch,
  ): Promise<CourierRechargeMatch> {
    if (current === CourierRechargeMatch.RESOLVED) return current;

    let linkedId = bankEntryId;
    if (linkedId === null && r.bankTxnRef !== null) {
      // Our own entry, found by the bank's reference. Restricted to
      // recharge-typed entries that are not already spoken for: the
      // UNIQUE on bank_entry_id would refuse a second claim anyway, and
      // failing to find one is the honest answer.
      const candidate = await this.prisma.client.bankEntry.findFirst({
        where: {
          type: BankEntryType.COURIER_WALLET_RECHARGE,
          reference: r.bankTxnRef,
          courierRecharge: { is: null },
        },
        select: { id: true },
      });
      linkedId = candidate?.id ?? null;
    }

    if (linkedId === null) {
      await this.prisma.client.courierWalletRecharge.update({
        where: { id: rechargeId },
        data: { matchState: CourierRechargeMatch.UNRECORDED },
      });
      await this.issues.raise({
        kind: SystemIssueKind.MONEY,
        severity: SystemIssueSeverity.HIGH,
        title: `A courier wallet recharge of ₹${r.amountInr} is not in our books`,
        detail:
          `Delhivery recorded a recharge (${r.externalTxnId}` +
          `${r.bankTxnRef === null ? '' : `, bank ref ${r.bankTxnRef}`}) that no bank entry of ` +
          `ours accounts for.\n\n` +
          'Every rupee in their wallet is supposed to have left one of our accounts, so this is ' +
          'either an entry somebody forgot or money that came from somewhere else. Record which ' +
          'account it came from on /courier-wallet — that writes the bank entry and links it.',
        source: 'CourierWalletReconcileService',
        dedupeKey: `courier-recharge-unrecorded:${accountId}:${r.externalTxnId}`,
        metadata: { courierAccountId: accountId, ...r },
      });
      return CourierRechargeMatch.UNRECORDED;
    }

    const entry = await this.prisma.client.bankEntry.findUnique({
      where: { id: linkedId },
      select: { signedAmount: true },
    });
    // Their credit against our debit: the bank side is negative because
    // the money left us, so it is compared on magnitude.
    const ours = entry?.signedAmount.abs() ?? new Prisma.Decimal(0);
    const theirs = new Prisma.Decimal(r.amountInr);
    const agree = ours.equals(theirs);

    await this.prisma.client.courierWalletRecharge.update({
      where: { id: rechargeId },
      data: {
        bankEntryId: linkedId,
        matchState: agree ? CourierRechargeMatch.MATCHED : CourierRechargeMatch.AMOUNT_MISMATCH,
      },
    });

    if (!agree) {
      await this.issues.raise({
        kind: SystemIssueKind.MONEY,
        severity: SystemIssueSeverity.CRITICAL,
        title: `A courier recharge and our bank entry disagree by ₹${ours.minus(theirs).abs().toFixed(2)}`,
        detail:
          `Our books say ₹${ours.toFixed(2)} left the bank; Delhivery says ₹${theirs.toFixed(2)} ` +
          `arrived (${r.externalTxnId}, bank ref ${r.bankTxnRef ?? '—'}).\n\n` +
          'Money went somewhere between the account and the wallet. Check the bank statement ' +
          'against their recharge before anything else is recorded on this account.',
        source: 'CourierWalletReconcileService',
        dedupeKey: `courier-recharge-mismatch:${accountId}:${r.externalTxnId}`,
        metadata: {
          courierAccountId: accountId,
          oursInr: ours.toFixed(2),
          theirsInr: theirs.toFixed(2),
          ...r,
        },
      });
    }
    return agree ? CourierRechargeMatch.MATCHED : CourierRechargeMatch.AMOUNT_MISMATCH;
  }

  /**
   * The scam shape: our bank says we paid, their wallet never saw it.
   *
   * Given a day to settle before it is called a problem — a payment made
   * this evening may genuinely not appear on their side until tomorrow,
   * and an alert that fires on every same-day recharge is one people
   * learn to dismiss.
   */
  private async findPaidButNeverArrived(): Promise<number> {
    const settled = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const orphans = await this.prisma.client.bankEntry.findMany({
      where: {
        type: BankEntryType.COURIER_WALLET_RECHARGE,
        courierRecharge: { is: null },
        occurredAt: { lt: settled },
      },
      select: { id: true, signedAmount: true, reference: true, occurredAt: true },
      take: 50,
    });
    for (const o of orphans) {
      await this.issues.raise({
        kind: SystemIssueKind.MONEY,
        severity: SystemIssueSeverity.CRITICAL,
        title:
          `₹${o.signedAmount.abs().toFixed(2)} left our bank for a courier wallet ` +
          `and never arrived`,
        detail:
          `A bank entry records a courier wallet recharge of ₹${o.signedAmount.abs().toFixed(2)} ` +
          `on ${o.occurredAt.toISOString().slice(0, 10)} (reference ${o.reference ?? '—'}), and ` +
          `no recharge on their side matches it more than a day later.\n\n` +
          'Either the reference on our entry is wrong, or the money did not reach them. Check ' +
          'the bank statement against their recharge list before recording anything else.',
        source: 'CourierWalletReconcileService',
        dedupeKey: `courier-recharge-never-arrived:${o.id}`,
        metadata: {
          bankEntryId: o.id,
          reference: o.reference,
          amountInr: o.signedAmount.abs().toFixed(2),
        },
      });
    }
    return orphans.length;
  }

  /** Store the snapshot, warn if it is running out, check it adds up. */
  private async checkBalance(
    accountId: string,
    label: string,
    balance: {
      balanceInr: string;
      /** THE SELECTED WINDOW's totals, not all-time — see the long note
       *  below. Stored because they cross-check the export. */
      totalCreditInr: string | null;
      totalDebitInr: string | null;
    } | null,
    /** What the wallet export for the same window summed to, when this
     *  run had one. Absent on a reconcile that ran without an import. */
    exportSumInr?: string,
  ): Promise<number> {
    if (balance === null) return 0;

    await this.prisma.client.courierWalletBalance.create({
      data: {
        courierAccountId: accountId,
        balanceInr: new Prisma.Decimal(balance.balanceInr),
        totalCreditInr:
          balance.totalCreditInr === null ? null : new Prisma.Decimal(balance.totalCreditInr),
        totalDebitInr:
          balance.totalDebitInr === null ? null : new Prisma.Decimal(balance.totalDebitInr),
      },
    });

    // Read GLOBALLY: a courier wallet is ours, not a seller's, so
    // SettingsResolverService's per-seller override has nothing to
    // resolve against here.
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: LOW_BALANCE_KEY },
      select: { valueDecimal: true },
    });
    const floor = new Prisma.Decimal(row?.valueDecimal?.toString() ?? DEFAULT_LOW_BALANCE);
    const current = new Prisma.Decimal(balance.balanceInr);

    /*
      ── WHAT THESE TOTALS ARE, AND THE CHECK THAT DIED WITH IT ────────

      This used to assert `credit − debit == balance` and raise CRITICAL
      when it did not, on the reasoning that a balance disagreeing with
      the running totals means the transaction list we were shown is
      short. The reasoning was sound. The premise was wrong.

      Their "Total Credit" and "Total Debit" are for the DATE WINDOW the
      Finances page currently has selected — not since inception. The
      balance is point-in-time. Subtracting one from the other and
      expecting the balance is a category error, so the check could
      never pass, and it fired CRITICAL every night on a healthy account
      while telling the reader that nothing else here could be trusted —
      discrediting the reconciliation that was working.

      Measured, not assumed. An all-time total can only grow; these
      moved DOWN as often as up:

        07 Sep  credit 60,086.54  debit 167,602.22
        08 Sep  credit 53,411.52  debit 133,782.35
        09 Sep  credit 53,704.64  debit 122,165.85
        10 Sep  credit 56,416.69  debit 113,163.95

      and each debit equals THAT night's wallet-export sum to the paisa,
      over the same rolling window.

      The original verification note in `wallet-recharges.page.ts` says
      the balance line was checked against the live page — and it was.
      It confirmed the labels were there and the numbers parsed. What it
      could not see from one reading is what the numbers MEAN, which is
      only visible across several. **Scraping a figure correctly and
      understanding it are separate acts, and a comment recording the
      first reads like a record of the second.**

      ── THE CHECK THAT REPLACES IT ────────────────────────────────────

      Windowed totals are not useless — they are the same window the
      export covers, from a different surface. So the page's stated
      debit should equal the sum of the rows in the file we downloaded.
      That is a real invariant between two independent readings of one
      source, and it catches exactly what the old check was reaching
      for: a truncated export sums BELOW what their own page says was
      charged.

      A rupee of tolerance, because their page rounds for display and
      the file does not — every capture above differs by exactly one
      paisa, which is the rounding and not a missing row.
    */
    const statedKey = `courier-wallet-totals-disagree:${accountId}`;
    const exportSum = exportSumInr === undefined ? null : new Prisma.Decimal(exportSumInr);
    if (balance.totalDebitInr !== null && exportSum !== null) {
      const stated = new Prisma.Decimal(balance.totalDebitInr);
      const gap = stated.minus(exportSum).abs();
      if (gap.greaterThan(ROUNDING_TOLERANCE_INR)) {
        await this.issues.raise({
          kind: SystemIssueKind.MONEY,
          severity: SystemIssueSeverity.HIGH,
          title: `${label}'s wallet export does not match their own page`,
          detail:
            `Their Finances page states ₹${stated.toFixed(2)} of debits for the window it is ` +
            `showing, but the export we downloaded for the same window sums to ` +
            `₹${exportSum.toFixed(2)} — a difference of ₹${gap.toFixed(2)}.\n\n` +
            'The two are independent readings of the same ledger, so they should agree. A ' +
            'shortfall in the file means rows are missing from it — a page we did not reach, a ' +
            'filter excluding rows, or a truncated download — and every courier cost imported ' +
            'from that file is therefore incomplete.',
          source: 'CourierWalletReconcileService',
          dedupeKey: statedKey,
          metadata: {
            courierAccountId: accountId,
            statedWindowDebitInr: stated.toFixed(2),
            exportSumInr: exportSum.toFixed(2),
            differenceInr: gap.toFixed(2),
          },
        });
      } else {
        // Cleared as soon as they agree again — an issue that can only
        // ever open is one people stop reading.
        await this.issues.resolveByKey(
          statedKey,
          'The export matches their stated window debit again',
        );
      }
    }

    if (current.lessThan(floor)) {
      await this.issues.raise({
        kind: SystemIssueKind.MONEY,
        severity: SystemIssueSeverity.HIGH,
        title: `${label} wallet is down to ₹${current.toFixed(2)}`,
        detail:
          `Their prepaid wallet holds ₹${current.toFixed(2)}, below the ₹${floor.toFixed(2)} ` +
          `floor.\n\n` +
          'At zero they stop issuing waybills, and orders begin failing at confirmation — which ' +
          'reaches you as courier refusals routed to manual placement rather than as anything ' +
          'saying "the wallet is empty". Top it up, and record the payment so it reconciles.',
        source: 'CourierWalletReconcileService',
        dedupeKey: `courier-wallet-low:${accountId}`,
        metadata: {
          courierAccountId: accountId,
          balanceInr: current.toFixed(2),
          floorInr: floor.toFixed(2),
        },
      });
      return 1;
    }

    // Topped up. Clears itself rather than waiting for somebody to close
    // a warning about a thing that is no longer true.
    await this.issues.resolveByKey(
      `courier-wallet-low:${accountId}`,
      `Balance back to ₹${current.toFixed(2)}`,
    );
    return 0;
  }
}
