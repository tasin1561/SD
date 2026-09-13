import { Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  CourierWalletTxnCategory,
  Prisma,
  SystemIssueKind,
  SystemIssueSeverity,
} from '@skydrop/db';
import type { Page } from 'playwright';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { DelhiveryBillingPage, type InvoiceCheckRead } from '../pages/delhivery-billing.page';
import type { ParsedListRow } from './delhivery-billing-probe-files';
import {
  DLV_ITEMIZED_OPTION,
  checkDelhiveryInvoices,
  invoiceKindOf,
  invoicesFromList,
  istMidnight,
  notesCoverageFrom,
  notesFromList,
  parseDlvItemized,
  type DlvInvoiceCheckResult,
  type DlvInvoiceCheckRow,
  type DlvInvoiceRead,
  type DlvLedgerTxn,
  type DlvNote,
  type DlvNoteResult,
} from './delhivery-invoice-rows';
import { ProbeBudget, type ProbeLimits } from './portal-read-only-guard';
import { PortalSessionService } from './portal-session.service';
import { decimalToPaise } from './shiprocket-invoice-rows';

export const ACTION_DLV_INVOICES_OK = 'courier.delhivery_invoices.checked';
export const ACTION_DLV_INVOICES_FAILED = 'courier.delhivery_invoices.check_failed';
export const SETTING_DLV_INVOICES_ENABLED = 'courier.delhivery_invoice_check_enabled';
export const SETTING_DLV_INVOICES_WINDOW = 'courier.delhivery_invoice_check_window_days';
export const SETTING_DLV_DISPUTE_DAYS = 'courier.delhivery_invoice_dispute_days';

/** Sixteen-odd invoices in the window, one file each, and the three lists. */
export const CHECK_LIMITS: ProbeLimits = { maxPages: 30, maxDownloads: 40 };
export const CHECK_DEADLINE_MS = 20 * 60_000;

/** The session raises this key on an OTP/captcha (PortalSessionService). */
const CHALLENGE_KEY = 'portal:challenge';
const DAY_MS = 24 * 60 * 60 * 1000;
/** A parcel is billed a month or two after it is booked; read the ledger well before the oldest invoice. */
const LEDGER_LEAD_DAYS = 150;
const AWB_CHUNK = 1000;
const SOURCE = 'DelhiveryInvoiceCheckService';
const NAME_CAP = 20;

export type DelhiveryInvoiceOutcome = 'CHECKED' | 'SKIPPED' | 'FAILED';

export interface DelhiveryInvoiceAccountResult {
  readonly courierAccountId: string;
  readonly label: string;
  readonly outcome: DelhiveryInvoiceOutcome;
  readonly detail: string | null;
  readonly invoicesRead: number;
  readonly result: DlvInvoiceCheckResult | null;
}

export interface DelhiveryInvoiceCheckSummary {
  readonly ranAt: string;
  readonly trigger: 'SCHEDULE' | 'MANUAL';
  readonly skipped: 'DISABLED' | 'NO_ACCOUNTS' | null;
  readonly windowDays: number;
  readonly disputeDays: number;
  readonly accounts: readonly DelhiveryInvoiceAccountResult[];
}

/**
 * Delhivery's invoices, checked every night against what their wallet
 * actually took (see `delhivery-invoice-rows.ts` for what their billing is,
 * the numbers the rules were measured on, and the rules themselves).
 *
 * ── WHY ──────────────────────────────────────────────────────────────
 * The wallet ledger is what we BOOK (COST-1): the money that left. The
 * invoice is the tax document for it, and nothing on their side forces the
 * two to agree — on the first one read, a lost parcel was billed ₹79.49 of
 * carriage their wallet had refunded. The cost figures do not change
 * either way; what this adds is being told while there is time to ask.
 *
 * ── HOW IT RUNS ──────────────────────────────────────────────────────
 * In the portal worker (never the API — it drives a browser), at 04:10
 * IST, on the wallet sync's OWN queue: that worker runs one job at a time,
 * so the check can never be signed in to the Delhivery login alongside the
 * 02:40 sync — which it follows, because it compares against the ledger the
 * sync stores. Signs in through `PortalSessionService` (never a second
 * credential path), reads the pages with the billing probe's code, and
 * compares with OUR stored ledger — never a second read of their page.
 * Like the sync it ignores `portalMode` (CUR-18 stops the escalation
 * automation, not a read) but stops on an open sign-in challenge.
 *
 * ── THE CLOCK ────────────────────────────────────────────────────────
 * How long Delhivery entertains an invoice dispute is NOT known;
 * `courier.delhivery_invoice_dispute_days` (15, our assumption, mirroring
 * Shiprocket) decides whether a disagreeing invoice is HIGH (still worth
 * raising — somebody is notified) or MEDIUM (recorded for the pattern).
 *
 * ── READS ONLY ───────────────────────────────────────────────────────
 * Navigates, reads, and downloads each invoice's "Invoice Transaction
 * list" through the probe's `judgeClick`. It writes nothing on their side
 * and nothing to a cost.
 */
@Injectable()
export class DelhiveryInvoiceCheckService {
  private readonly logger = new Logger(DelhiveryInvoiceCheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly session: PortalSessionService,
    private readonly audit: AuditLogService,
    private readonly issues: SystemIssueService,
  ) {}

  async check(
    trigger: 'SCHEDULE' | 'MANUAL',
    now: Date = new Date(),
  ): Promise<DelhiveryInvoiceCheckSummary> {
    const [enabled, windowDays, disputeDays] = await Promise.all([
      this.flag(SETTING_DLV_INVOICES_ENABLED),
      this.int(SETTING_DLV_INVOICES_WINDOW, 120),
      this.int(SETTING_DLV_DISPUTE_DAYS, 15),
    ]);
    const base = { ranAt: now.toISOString(), trigger, windowDays, disputeDays };
    if (!enabled) return this.finish({ ...base, skipped: 'DISABLED', accounts: [] });

    // The same accounts the wallet sync signs in as.
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
    if (accounts.length === 0) {
      return this.finish({ ...base, skipped: 'NO_ACCOUNTS', accounts: [] });
    }
    const challenge = await this.prisma.client.systemIssue.findFirst({
      where: { dedupeKey: CHALLENGE_KEY, resolvedAt: null },
      select: { id: true },
    });

    const results: DelhiveryInvoiceAccountResult[] = [];
    for (const account of accounts) {
      if (challenge !== null) {
        results.push(
          blank(
            account,
            'SKIPPED',
            'A Delhivery sign-in challenge is open — resolve it first. Nothing was opened.',
          ),
        );
        continue;
      }
      results.push(await this.checkAccount(account, now, windowDays, disputeDays));
    }
    return this.finish({ ...base, skipped: null, accounts: results });
  }

  private async checkAccount(
    account: { id: string; label: string },
    now: Date,
    windowDays: number,
    disputeDays: number,
  ): Promise<DelhiveryInvoiceAccountResult> {
    const failureKey = `delhivery-invoice-check:${account.id}`;
    const since = new Date(now.getTime() - windowDays * DAY_MS);

    let page: Page;
    try {
      page = await this.session.page(account.id);
    } catch (err) {
      const message = errorText(err);
      await this.raiseFailure(
        account,
        failureKey,
        `could not open the signed-in portal: ${message}`,
      );
      return blank(account, 'FAILED', message.slice(0, 300));
    }

    try {
      const read = await this.readInvoices(page, (row) => wanted(row, since));
      if (!read.found) {
        throw new Error(
          read.error ?? 'no invoice table was found at /finances/invoices/invoice_list',
        );
      }
      const { invoices, unreadable } = invoicesFromList(read.invoices);
      const inWindow = invoices.filter((i) => i.invoiceDate.getTime() >= since.getTime());
      const reads: DlvInvoiceRead[] = inWindow.map((invoice) => {
        if (invoice.kind === 'OTHER') return { invoice, itemized: null, problem: null };
        const file = read.files.get(invoice.invoiceId);
        if (file === undefined) {
          return {
            invoice,
            itemized: null,
            problem:
              read.stoppedBy !== null
                ? `not fetched — the run stopped at its ${read.stoppedBy.toLowerCase()} limit`
                : `not fetched${read.error === null ? '' : ` — ${read.error.slice(0, 160)}`}`,
          };
        }
        if (file === null) {
          return {
            invoice,
            itemized: null,
            problem: 'its Download menu offered no "Transaction list"',
          };
        }
        if (file instanceof Error) {
          return { invoice, itemized: null, problem: file.message.slice(0, 200) };
        }
        try {
          return { invoice, itemized: parseDlvItemized(file), problem: null };
        } catch (err) {
          return { invoice, itemized: null, problem: errorText(err).slice(0, 200) };
        }
      });

      const credit = notesOf(read.creditNotes);
      const debit = notesOf(read.debitNotes);
      const awbs = new Set<string>();
      for (const r of reads) {
        if (r.itemized?.kind === 'DOMESTIC') for (const l of r.itemized.lines) awbs.add(l.awb);
      }
      const oldest = Math.min(since.getTime(), ...inWindow.map((i) => i.invoiceDate.getTime()));
      const { txns, ledgerStart } = await this.loadLedger(
        account.id,
        [...awbs],
        new Date(oldest - LEDGER_LEAD_DAYS * DAY_MS),
      );
      const result = checkDelhiveryInvoices({
        invoices: reads,
        creditNotes: credit?.notes ?? null,
        debitNotes: debit?.notes ?? null,
        notesFrom: notesCoverageFrom(read.creditNotes?.rangeLabel ?? null, now),
        txns,
        ledgerStart,
        now,
        disputeDays,
      });
      await this.report(account, result, disputeDays, {
        listProblems: [
          ...unreadable.map((u) => `invoice list row ${u}`),
          ...(credit?.unreadable ?? []).map((u) => `credit note row ${u}`),
          ...(debit?.unreadable ?? []).map((u) => `debit note row ${u}`),
          ...(read.creditNotes === null || credit === null ? ['the Credit Notes tab'] : []),
          ...(read.debitNotes === null || debit === null ? ['the Debit Notes tab'] : []),
        ],
        stoppedBy: read.stoppedBy,
      });
      return {
        courierAccountId: account.id,
        label: account.label,
        outcome: 'CHECKED',
        detail: null,
        invoicesRead: inWindow.length,
        result,
      };
    } catch (err) {
      const message = errorText(err);
      this.logger.error(
        { courierAccountId: account.id, err: message },
        'Delhivery invoice check failed',
      );
      await this.raiseFailure(account, failureKey, message);
      return blank(account, 'FAILED', message.slice(0, 300));
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /**
   * The pages, read the billing probe's way — its own method so the rest
   * can be tested without a browser. No screenshots are kept: this runs
   * every night and answers a question the probe already answered once.
   */
  protected async readInvoices(
    page: Page,
    wantedRow: (row: ParsedListRow) => boolean,
  ): Promise<InvoiceCheckRead> {
    const budget = new ProbeBudget(CHECK_LIMITS, Date.now() + CHECK_DEADLINE_MS);
    return new DelhiveryBillingPage(page, budget, undefined, { record: false }).readForInvoiceCheck(
      {
        wanted: wantedRow,
        option: DLV_ITEMIZED_OPTION,
      },
    );
  }

  /**
   * The wallet side, from OUR stored ledger — the same transactions the
   * parcel costs come from (COST-1), excluding any stamped as vanished.
   *
   *   1. every transaction naming a waybill an invoice bills, ALL TIME —
   *      a parcel's net is judged whole, never windowed by the invoice;
   *   2. every carriage transaction since `since`, for waybills charged
   *      and never billed;
   *   3. every adjustment since `since` — claim payouts, VAS lumps and
   *      the debits a debit note should match — with its description.
   */
  private async loadLedger(
    courierAccountId: string,
    awbs: readonly string[],
    since: Date,
  ): Promise<{ txns: DlvLedgerTxn[]; ledgerStart: Date | null }> {
    const held = { courierAccountId, missingFromExportAt: null } as const;
    const pick = {
      txnId: true,
      awbNumber: true,
      kind: true,
      category: true,
      amountInr: true,
      occurredAt: true,
    } as const;
    const out = new Map<string, DlvLedgerTxn>();
    const add = (r: {
      txnId: string;
      awbNumber: string | null;
      kind: string;
      category: string;
      amountInr: Prisma.Decimal;
      occurredAt: Date;
      detail?: Prisma.JsonValue | null;
    }): void => {
      if (out.has(r.txnId)) return;
      const detail =
        r.detail !== undefined &&
        r.detail !== null &&
        typeof r.detail === 'object' &&
        !Array.isArray(r.detail)
          ? (r.detail as Record<string, unknown>)
          : null;
      out.set(r.txnId, {
        txnId: r.txnId,
        awb: r.awbNumber,
        kind: r.kind === 'CREDIT' ? 'CREDIT' : 'DEBIT',
        category: r.category === 'ADJUSTMENT' ? 'ADJUSTMENT' : 'PARCEL',
        amountPaise: decimalToPaise(r.amountInr.toFixed(2)) ?? 0,
        occurredAt: r.occurredAt,
        detail,
      });
    };

    for (let i = 0; i < awbs.length; i += AWB_CHUNK) {
      const rows = await this.prisma.client.courierWalletTransaction.findMany({
        where: { ...held, awbNumber: { in: awbs.slice(i, i + AWB_CHUNK) } },
        select: { ...pick, detail: true },
      });
      rows.forEach(add);
    }
    const [adjustments, carriage, first] = await Promise.all([
      this.prisma.client.courierWalletTransaction.findMany({
        where: {
          ...held,
          category: CourierWalletTxnCategory.ADJUSTMENT,
          occurredAt: { gte: since },
        },
        select: { ...pick, detail: true },
      }),
      this.prisma.client.courierWalletTransaction.findMany({
        where: { ...held, category: CourierWalletTxnCategory.PARCEL, occurredAt: { gte: since } },
        select: pick,
      }),
      this.prisma.client.courierWalletTransaction.aggregate({
        where: held,
        _min: { occurredAt: true },
      }),
    ]);
    adjustments.forEach(add);
    carriage.forEach(add);
    return { txns: [...out.values()], ledgerStart: first._min.occurredAt };
  }

  /**
   * One issue per invoice that disagrees (HIGH while a dispute is assumed
   * still possible), and one each for waybills charged and never billed,
   * notes that match nothing, VAS lumps naming an invoice not on the list,
   * and anything that could not be read. Every one clears itself.
   */
  private async report(
    account: { id: string; label: string },
    result: DlvInvoiceCheckResult,
    disputeDays: number,
    extra: { listProblems: readonly string[]; stoppedBy: string | null },
  ): Promise<void> {
    for (const row of result.rows) {
      const key = `delhivery-invoice:${account.id}:${row.invoiceId}`;
      if (row.status === 'DIFFERS') {
        await this.issues.raise({
          kind: SystemIssueKind.MONEY,
          severity: row.disputeOpen ? SystemIssueSeverity.HIGH : SystemIssueSeverity.MEDIUM,
          title:
            `Delhivery invoice ${row.invoiceId} (${row.serviceType}, ${row.invoiceDate}, ` +
            `₹${row.totalInr}) does not match what their wallet charged`,
          detail: invoiceDetail(row, disputeDays),
          source: SOURCE,
          dedupeKey: key,
          metadata: {
            courierAccountId: account.id,
            invoiceId: row.invoiceId,
            invoiceDate: row.invoiceDate,
            disputeBy: row.disputeBy,
            totalsAgree: row.totalsAgree,
            grossInr: row.grossInr,
            differenceInr: row.differenceInr,
            differences: row.differences.slice(0, 25).map((d) => ({ ...d })),
            vasLumpInr: row.vasLumpInr,
            vasLumpProblem: row.vasLumpProblem,
          },
        });
      } else if (row.status === 'MATCHES') {
        await this.issues.resolveByKey(key, 'The invoice now matches what the wallet charged.');
      }
    }

    const un = result.uninvoiced;
    const unKey = `delhivery-uninvoiced:${account.id}`;
    if (un.count > 0) {
      await this.issues.raise({
        kind: SystemIssueKind.MONEY,
        severity: SystemIssueSeverity.MEDIUM,
        title: `${un.count} Delhivery waybill(s), ₹${un.inr}, were charged to the wallet and never invoiced`,
        detail:
          'Their wallet was charged for these waybills and no Domestic invoice has billed them — ' +
          'not the half-month invoice after their last charge, nor the one after that. The money ' +
          'is counted as a cost either way (it comes from the wallet); what is missing is the tax ' +
          'invoice for it. Worth asking Delhivery to invoice or refund.\n\n' +
          un.items
            .slice(0, NAME_CAP)
            .map(
              (u) =>
                `${u.awb} · net ₹${u.netInr} · charged ${u.firstChargedAt}` +
                (u.lastChargedAt === u.firstChargedAt ? '' : ` to ${u.lastChargedAt}`),
            )
            .join('\n'),
        source: SOURCE,
        dedupeKey: unKey,
        metadata: {
          courierAccountId: account.id,
          count: un.count,
          inr: un.inr,
          items: un.items.slice(0, 25).map((u) => ({ ...u })),
        },
      });
    } else {
      await this.issues.resolveByKey(unKey, 'Every waybill old enough is on an invoice.');
    }

    await this.reportNotes(account, result);

    const unreadable = result.rows.filter((r) => r.status === 'UNREADABLE');
    const lines = [
      ...unreadable.map((r) => `${r.invoiceId} (${r.invoiceDate}) — ${r.problem ?? 'unreadable'}`),
      ...extra.listProblems.map((p) => `${p} could not be read`),
      ...(extra.stoppedBy === null
        ? []
        : [`the run stopped at its ${extra.stoppedBy.toLowerCase()} limit`]),
    ];
    const failureKey = `delhivery-invoice-check:${account.id}`;
    if (lines.length > 0) {
      await this.issues.raise({
        kind: SystemIssueKind.COURIER_COST_SYNC,
        severity: SystemIssueSeverity.MEDIUM,
        title: `Part of ${account.label}'s Delhivery billing could not be checked`,
        detail:
          'These were not compared with the wallet tonight:\n\n' +
          lines.slice(0, 30).join('\n') +
          '\n\nCosts are unaffected — they come from the wallet. It retries tonight.',
        source: SOURCE,
        dedupeKey: failureKey,
        metadata: { courierAccountId: account.id, problems: lines.slice(0, 50) },
      });
    } else {
      await this.issues.resolveByKey(failureKey, 'Every Delhivery invoice was read and checked.');
    }
  }

  private async reportNotes(
    account: { id: string; label: string },
    result: DlvInvoiceCheckResult,
  ): Promise<void> {
    const creditKey = `delhivery-credit-notes:${account.id}`;
    if (result.creditNotes !== null) {
      const unmatched = result.creditNotes.filter((n) => n.status === 'UNMATCHED');
      const claims = result.claimsWithoutNote;
      if (unmatched.length > 0 || claims.length > 0) {
        await this.issues.raise({
          kind: SystemIssueKind.MONEY,
          severity: SystemIssueSeverity.MEDIUM,
          title:
            `Delhivery credit notes and lost-shipment claims do not pair up ` +
            `(${unmatched.length} note(s), ${claims.length} claim payout(s))`,
          detail:
            'A credit note is Delhivery settling a lost-shipment claim; the money arrives in ' +
            'their wallet as a "Claim settled - CMS" credit within a few days of the note.' +
            (unmatched.length === 0
              ? ''
              : '\n\nCredit notes with no matching claim credit in the wallet:\n' +
                noteLines(unmatched)) +
            (claims.length === 0
              ? ''
              : `\n\nClaim credits older than 15 days with no credit note:\n` +
                claims
                  .slice(0, NAME_CAP)
                  .map((c) => `${c.at} · ₹${c.amountInr}${c.awb === null ? '' : ` · ${c.awb}`}`)
                  .join('\n')),
          source: SOURCE,
          dedupeKey: creditKey,
          metadata: {
            courierAccountId: account.id,
            notes: unmatched.map((n) => ({ ...n })),
            claims: claims.slice(0, 25).map((c) => ({ ...c })),
          },
        });
      } else {
        await this.issues.resolveByKey(creditKey, 'Every credit note matches its claim credits.');
      }
    }

    const debitKey = `delhivery-debit-notes:${account.id}`;
    if (result.debitNotes !== null) {
      const unmatched = result.debitNotes.filter((n) => n.status === 'UNMATCHED');
      if (unmatched.length > 0) {
        await this.issues.raise({
          kind: SystemIssueKind.MONEY,
          severity: SystemIssueSeverity.MEDIUM,
          title: `${unmatched.length} Delhivery debit note(s) match no wallet debit`,
          detail:
            'Each debit note should correspond to account-level debits in their wallet posted ' +
            'within a few days of it. These found none:\n' +
            noteLines(unmatched),
          source: SOURCE,
          dedupeKey: debitKey,
          metadata: { courierAccountId: account.id, notes: unmatched.map((n) => ({ ...n })) },
        });
      } else {
        await this.issues.resolveByKey(debitKey, 'Every debit note matches wallet debits.');
      }
    }

    const vasKey = `delhivery-vas-unlisted:${account.id}`;
    if (result.vasLumpsUnlisted.length > 0) {
      await this.issues.raise({
        kind: SystemIssueKind.MONEY,
        severity: SystemIssueSeverity.MEDIUM,
        title: `${result.vasLumpsUnlisted.length} Delhivery VAS wallet debit(s) name an invoice their list does not show`,
        detail:
          'Their wallet takes each Communication VAS invoice as one debit naming it. These name ' +
          'an invoice that is not on the invoice list:\n' +
          result.vasLumpsUnlisted
            .slice(0, NAME_CAP)
            .map((l) => `${l.at} · ₹${l.amountInr} · ${l.invoiceId}`)
            .join('\n'),
        source: SOURCE,
        dedupeKey: vasKey,
        metadata: {
          courierAccountId: account.id,
          lumps: result.vasLumpsUnlisted.slice(0, 25).map((l) => ({ ...l })),
        },
      });
    } else {
      await this.issues.resolveByKey(vasKey, 'Every VAS wallet debit names a listed invoice.');
    }
  }

  private async raiseFailure(
    account: { id: string; label: string },
    key: string,
    message: string,
  ): Promise<void> {
    await this.issues.raise({
      kind: SystemIssueKind.COURIER_COST_SYNC,
      severity: SystemIssueSeverity.MEDIUM,
      title: `Could not check ${account.label}'s Delhivery invoices`,
      detail:
        `The nightly invoice check failed: ${message.slice(0, 400)}\n\n` +
        'Costs are unaffected — they come from the wallet — but invoices are not being compared ' +
        'with it. It retries tonight; if it keeps failing their billing pages have probably changed ' +
        '(the billing probe, POST /admin/courier-portal/delhivery-billing-probe, shows what they ' +
        'look like now).',
      source: SOURCE,
      dedupeKey: key,
      metadata: { courierAccountId: account.id, error: message.slice(0, 500) },
    });
  }

  private async finish(
    summary: DelhiveryInvoiceCheckSummary,
  ): Promise<DelhiveryInvoiceCheckSummary> {
    const failed = summary.accounts.filter((a) => a.outcome !== 'CHECKED').length;
    const allFailed = summary.accounts.length > 0 && failed === summary.accounts.length;
    const differing = summary.accounts.reduce(
      (n, a) => n + (a.result?.rows.filter((r) => r.status === 'DIFFERS').length ?? 0),
      0,
    );
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: allFailed ? ACTION_DLV_INVOICES_FAILED : ACTION_DLV_INVOICES_OK,
      entityType: 'courier',
      // A UUID column; the courier code goes in metadata.
      entityId: null,
      severity: failed > 0 || differing > 0 ? 'HIGH' : 'LOW',
      metadata: {
        courierCode: 'delhivery',
        ...summary,
        accounts: summary.accounts.map((a) => ({ ...a })),
      },
    });
    this.logger.log(
      { accounts: summary.accounts.length, failed, differing, skipped: summary.skipped },
      'Delhivery invoice check done',
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

function blank(
  account: { id: string; label: string },
  outcome: DelhiveryInvoiceOutcome,
  detail: string | null,
): DelhiveryInvoiceAccountResult {
  return {
    courierAccountId: account.id,
    label: account.label,
    outcome,
    detail,
    invoicesRead: 0,
    result: null,
  };
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** An invoice in the window, of a type whose itemized file is checked. */
function wanted(row: ParsedListRow, since: Date): boolean {
  if (invoiceKindOf(row.serviceType ?? '') === 'OTHER' || row.date === null) return false;
  const d = istMidnight(row.date);
  return d !== null && d.getTime() >= since.getTime();
}

/** A notes tab read: its notes when its rows drew (or it said it was empty), else null. */
function notesOf(
  finding: InvoiceCheckRead['creditNotes'],
): { notes: DlvNote[]; unreadable: string[] } | null {
  if (finding === null) return null;
  if (finding.loaded === 'empty') return { notes: [], unreadable: [] };
  if (finding.loaded !== 'rows') return null;
  return notesFromList(finding.parsedRows);
}

function noteLines(notes: readonly DlvNoteResult[]): string {
  return notes
    .slice(0, NAME_CAP)
    .map((n) => `${n.noteId} · ${n.issuedAt} · ₹${n.amountInr}`)
    .join('\n');
}

function invoiceDetail(row: DlvInvoiceCheckRow, disputeDays: number): string {
  const parts: string[] = [];
  if (row.totalsAgree === false) {
    parts.push(
      `Its transaction list does not add up to the invoice: gross ₹${row.grossInr ?? '?'} ` +
        `(+18% GST) and line totals ₹${row.linesTotalInr ?? '?'}, against the ₹${row.totalInr} invoiced.`,
    );
  }
  if (row.differenceCount > 0) {
    parts.push(
      `${row.differenceCount} waybill(s) billed differently from the net of everything their ` +
        `wallet charged and refunded on them (billed minus charged, overall: ₹${row.differenceInr}):\n` +
        row.differences
          .slice(0, NAME_CAP)
          .map(
            (d) =>
              `${d.awb}${d.status === '' ? '' : ` (${d.status})`} · billed ₹${d.billedInr} · wallet net ₹${d.walletInr}`,
          )
          .join('\n'),
    );
  }
  if (row.vasLumpProblem !== null) {
    parts.push(`Communication VAS: ${row.vasLumpProblem}.`);
  }
  if (row.beforeRecords > 0) {
    parts.push(
      `${row.beforeRecords} line(s) are for waybills booked before our wallet ledger begins, and were counted, not compared.`,
    );
  }
  parts.push(
    row.disputeOpen
      ? `How long Delhivery entertains an invoice dispute is not known; we assume ${disputeDays} ` +
          `days from the invoice date (courier.delhivery_invoice_dispute_days) — by ${row.disputeBy}.`
      : `The ${disputeDays}-day window we assume for disputing it closed on ${row.disputeBy}; it is ` +
          'recorded so the pattern is visible.',
  );
  return parts.join('\n\n');
}
