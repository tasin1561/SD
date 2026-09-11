import { Injectable, Logger } from '@nestjs/common';
import { ActorType, SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { ShiprocketInvoicesPage } from '../pages/shiprocket-invoices.page';
import {
  SR_DISPUTE_DAYS,
  SR_ITEMIZED_TYPES,
  checkInvoices,
  decimalToPaise,
  parseInvoiceList,
  parseItemized,
  type InvoiceCheckResult,
  type InvoiceCheckRow,
  type InvoiceRead,
  type WalletMove,
} from './shiprocket-invoice-rows';
import { shiprocketDate } from './shiprocket-portal-probe.service';
import { raiseShiprocketOpenFailure } from './shiprocket-portal-failures';
import {
  ShiprocketPortalSessionService,
  type ShiprocketPortalHandle,
} from './shiprocket-portal-session.service';

export const ACTION_SR_INVOICES_OK = 'courier.shiprocket_invoices.checked';
export const ACTION_SR_INVOICES_FAILED = 'courier.shiprocket_invoices.check_failed';
export const SETTING_SR_INVOICES_ENABLED = 'courier.shiprocket_invoice_check_enabled';
export const SETTING_SR_INVOICES_WINDOW = 'courier.shiprocket_invoice_check_window_days';

const DAY_MS = 24 * 60 * 60 * 1000;
const SOURCE = 'ShiprocketInvoiceCheckService';

export type ShiprocketInvoiceOutcome = 'CHECKED' | 'SKIPPED' | 'CHALLENGE' | 'NO_LOGIN' | 'FAILED';

export interface ShiprocketInvoiceAccountResult {
  readonly courierAccountId: string;
  readonly label: string;
  readonly outcome: ShiprocketInvoiceOutcome;
  readonly detail: string | null;
  readonly invoicesRead: number;
  readonly result: InvoiceCheckResult | null;
}

export interface ShiprocketInvoiceCheckSummary {
  readonly ranAt: string;
  readonly trigger: 'SCHEDULE' | 'MANUAL';
  readonly skipped: 'DISABLED' | 'NO_ACCOUNTS' | null;
  readonly windowDays: number;
  readonly accounts: readonly ShiprocketInvoiceAccountResult[];
}

/** The invoice list and each itemized file, as read off their panel. */
export interface InvoicesRead {
  readonly rows: string[][];
  /** Per invoice id: the file, null when its view offered none, or why it could not be had. */
  readonly files: ReadonlyMap<string, Buffer | Error | null>;
}

/**
 * Shiprocket's invoices, checked every night against what their wallet
 * actually took (see `shiprocket-invoice-rows.ts` for what an invoice is
 * and the rules of the comparison).
 *
 * ── WHY A SECOND LOOK AT MONEY THE WALLET SYNC ALREADY RECORDED ─────
 * The passbook is what we BOOK: it is the money that left. The invoice is
 * the tax document for it — what GST input credit is claimed on, and what
 * Shiprocket will stand behind in a dispute. On 90 days of real data the
 * two disagreed for 91 WhatsApp charges: money taken, never invoiced. The
 * cost figures do not change either way; what this adds is being told,
 * while there is still time to ask.
 *
 * ── THE CLOCK ───────────────────────────────────────────────────────
 * Their invoices settle a discrepancy only if it is raised within 15 days
 * of the invoice date. So it runs nightly rather than monthly — invoices
 * arrive on their schedule, several a month — and an invoice that
 * disagrees while that window is open is HIGH (a person is notified);
 * once it has closed it is MEDIUM, recorded so the pattern is visible.
 *
 * ── READS ONLY ──────────────────────────────────────────────────────
 * It opens pages and fetches the files their own "Download Now" links
 * point at. It writes nothing on their side and nothing to a cost.
 */
@Injectable()
export class ShiprocketInvoiceCheckService {
  private readonly logger = new Logger(ShiprocketInvoiceCheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly session: ShiprocketPortalSessionService,
    private readonly audit: AuditLogService,
    private readonly issues: SystemIssueService,
  ) {}

  async check(
    trigger: 'SCHEDULE' | 'MANUAL',
    now: Date = new Date(),
  ): Promise<ShiprocketInvoiceCheckSummary> {
    const [enabled, windowDays] = await Promise.all([
      this.flag(SETTING_SR_INVOICES_ENABLED),
      this.int(SETTING_SR_INVOICES_WINDOW, 120),
    ]);
    const base = { ranAt: now.toISOString(), trigger, windowDays };
    if (!enabled) return this.finish({ ...base, skipped: 'DISABLED', accounts: [] });

    const accounts = await this.prisma.client.courierAccount.findMany({
      where: { courier: { code: 'shiprocket' }, isActive: true, deletedAt: null },
      select: { id: true, label: true },
      orderBy: { createdAt: 'asc' },
    });
    if (accounts.length === 0)
      return this.finish({ ...base, skipped: 'NO_ACCOUNTS', accounts: [] });

    const results: ShiprocketInvoiceAccountResult[] = [];
    for (const account of accounts) {
      results.push(await this.checkAccount(account, now, windowDays));
    }
    return this.finish({ ...base, skipped: null, accounts: results });
  }

  private async checkAccount(
    account: { id: string; label: string },
    now: Date,
    windowDays: number,
  ): Promise<ShiprocketInvoiceAccountResult> {
    const blank = (
      outcome: ShiprocketInvoiceOutcome,
      detail: string | null,
    ): ShiprocketInvoiceAccountResult => ({
      courierAccountId: account.id,
      label: account.label,
      outcome,
      detail,
      invoicesRead: 0,
      result: null,
    });
    const failureKey = `shiprocket-invoice-check:${account.id}`;

    const open = await this.prisma.client.systemIssue.findFirst({
      where: { dedupeKey: `shiprocket-portal-challenge:${account.id}`, resolvedAt: null },
      select: { id: true },
    });
    if (open !== null)
      return blank('SKIPPED', 'A sign-in challenge is still open for this account.');

    let handle: ShiprocketPortalHandle;
    try {
      handle = await this.session.open(account.id, `invoices-${now.getTime()}`);
    } catch (err) {
      const f = await raiseShiprocketOpenFailure(this.issues, {
        source: SOURCE,
        account,
        err,
        failureKey,
      });
      return blank(f.outcome, f.message.slice(0, 300));
    }

    const from = shiprocketDate(new Date(now.getTime() - windowDays * DAY_MS));
    const to = shiprocketDate(now);
    try {
      const read = await this.readInvoices(handle, from, to);
      const invoices = parseInvoiceList(read.rows);
      const reads: InvoiceRead[] = invoices.map((invoice) => {
        if (!SR_ITEMIZED_TYPES.has(invoice.serviceType)) {
          return { invoice, itemized: null, problem: null };
        }
        const file = read.files.get(invoice.invoiceId);
        if (file === undefined || file === null) {
          return {
            invoice,
            itemized: null,
            problem: 'their invoice view offered no itemized file',
          };
        }
        if (file instanceof Error) {
          return { invoice, itemized: null, problem: file.message.slice(0, 200) };
        }
        try {
          return { invoice, itemized: parseItemized(file), problem: null };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { invoice, itemized: null, problem: message.slice(0, 200) };
        }
      });

      const { moves, ledgerStart } = await this.loadLedger(account.id, now, windowDays);
      const result = checkInvoices({ invoices: reads, moves, ledgerStart, now });
      await this.report(account, result);
      return {
        courierAccountId: account.id,
        label: account.label,
        outcome: 'CHECKED',
        detail: null,
        invoicesRead: invoices.length,
        result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { courierAccountId: account.id, err: message },
        'Shiprocket invoice check failed',
      );
      await this.issues.raise({
        kind: SystemIssueKind.COURIER_COST_SYNC,
        severity: SystemIssueSeverity.MEDIUM,
        title: `Could not check ${account.label}'s Shiprocket invoices`,
        detail:
          `The nightly invoice check failed: ${message.slice(0, 400)}\n\n` +
          'Costs are unaffected — they come from the wallet — but invoices are not being ' +
          'compared, and a discrepancy can only be disputed within 15 days of its invoice. It ' +
          'retries tonight; if it keeps failing their panel has probably changed.',
        source: SOURCE,
        dedupeKey: failureKey,
        metadata: { courierAccountId: account.id, error: message.slice(0, 500) },
      });
      return blank('FAILED', message.slice(0, 300));
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  /**
   * The list and every itemized file, in a FRESH tab (a tab their router
   * has redirected can stop painting). Its own method so the rest can be
   * tested without a browser. One invoice's file failing is recorded
   * against that invoice, not the night.
   */
  protected async readInvoices(
    handle: ShiprocketPortalHandle,
    from: string,
    to: string,
  ): Promise<InvoicesRead> {
    const page = await handle.newPage();
    try {
      const p = new ShiprocketInvoicesPage(page);
      const rows = await p.list(from, to);
      const files = new Map<string, Buffer | Error | null>();
      for (const invoice of parseInvoiceList(rows)) {
        if (!SR_ITEMIZED_TYPES.has(invoice.serviceType)) continue;
        try {
          const file = await p.itemizedFile(invoice.invoiceId);
          files.set(invoice.invoiceId, file?.body ?? null);
        } catch (err) {
          files.set(invoice.invoiceId, err instanceof Error ? err : new Error(String(err)));
        }
      }
      return { rows, files };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /**
   * The wallet side, from OUR stored ledger — the same movements the cost
   * figures come from, never a second read of their page. The ledger's
   * start is where judging begins: a line for a parcel or order older than
   * the first movement we hold cannot be compared, only counted.
   */
  private async loadLedger(
    courierAccountId: string,
    now: Date,
    windowDays: number,
  ): Promise<{ moves: WalletMove[]; ledgerStart: Date | null }> {
    // Wide enough for the parcels the oldest invoice in the window bills
    // (booked a month or two before it), without reading the whole ledger.
    const since = new Date(now.getTime() - (windowDays + 120) * DAY_MS);
    const [rows, first] = await Promise.all([
      this.prisma.client.courierWalletTransaction.findMany({
        where: {
          courierAccountId,
          missingFromExportAt: null,
          occurredAt: { gte: since },
          OR: [
            { detail: { path: ['transactionType'], equals: 'VAS' } },
            { detail: { path: ['transactionType'], equals: 'Freight Charges' } },
          ],
        },
        select: { occurredAt: true, kind: true, amountInr: true, awbNumber: true, detail: true },
      }),
      this.prisma.client.courierWalletTransaction.aggregate({
        where: { courierAccountId, missingFromExportAt: null },
        _min: { occurredAt: true },
      }),
    ]);
    const firstHeld = first._min.occurredAt;
    const ledgerStart =
      firstHeld === null ? null : firstHeld.getTime() > since.getTime() ? firstHeld : since;
    const moves: WalletMove[] = rows.map((r) => {
      const d = (r.detail !== null && typeof r.detail === 'object' ? r.detail : {}) as Record<
        string,
        unknown
      >;
      const paise = decimalToPaise(r.amountInr.toFixed(2)) ?? 0;
      const str = (k: string): string | null => {
        const v = d[k];
        return typeof v === 'string' && v !== '' ? v : null;
      };
      return {
        occurredAt: r.occurredAt,
        costPaise: r.kind === 'DEBIT' ? paise : -paise,
        orderId: str('orderId'),
        awb: str('awbNumber') ?? r.awbNumber,
        transactionType: str('transactionType') ?? '',
        subCategory: str('subCategory') ?? '',
      };
    });
    return { moves, ledgerStart };
  }

  /** One issue per invoice that disagrees, one for uninvoiced VAS, one for unreadable files. */
  private async report(
    account: { id: string; label: string },
    result: InvoiceCheckResult,
  ): Promise<void> {
    for (const row of result.rows) {
      const key = `shiprocket-invoice:${account.id}:${row.invoiceId}`;
      if (row.status === 'DIFFERS') {
        await this.issues.raise({
          kind: SystemIssueKind.MONEY,
          // Loud while it can still be disputed; recorded once it cannot.
          severity: row.disputeOpen ? SystemIssueSeverity.HIGH : SystemIssueSeverity.MEDIUM,
          title:
            `Shiprocket invoice ${row.invoiceId} (${row.serviceType}, ${row.invoiceDate}) ` +
            'does not match what their wallet charged',
          detail: invoiceDetail(row),
          source: SOURCE,
          dedupeKey: key,
          metadata: {
            courierAccountId: account.id,
            invoiceId: row.invoiceId,
            invoiceDate: row.invoiceDate,
            disputeBy: row.disputeBy,
            totalsAgree: row.totalsAgree,
            differenceInr: row.differenceInr,
            differences: row.differences.slice(0, 25).map((d) => ({ ...d })),
            unknownServices: [...row.unknownServices],
          },
        });
      } else if (row.status === 'MATCHES') {
        await this.issues.resolveByKey(key, 'The invoice now matches what the wallet charged.');
      }
    }

    const vas = result.vasUninvoiced;
    const vasKey = `shiprocket-vas-uninvoiced:${account.id}`;
    if (vas.count > 0) {
      await this.issues.raise({
        kind: SystemIssueKind.MONEY,
        severity: SystemIssueSeverity.MEDIUM,
        title: `${vas.count} Shiprocket VAS charge(s), ₹${vas.inr}, were taken from the wallet and never invoiced`,
        detail:
          'Their wallet was charged for these extras (WhatsApp messages, RTO-risk scores, ' +
          'Delivery Boost) and no monthly VAS invoice has billed them — not the month they ' +
          'belong to, nor the one after. The money is counted as a cost either way; what is ' +
          'missing is the tax invoice for it (no GST input credit without one), and Shiprocket ' +
          'has taken it without billing it. Worth asking them to invoice or refund.\n\n' +
          groupedVas(vas.items) +
          '\n\nFirst few:\n' +
          vas.items
            .slice(0, 15)
            .map(
              (u) =>
                `${u.lastChargedAt} · order ${u.orderId} · ${u.service} · charged ₹${u.chargedInr}, invoiced ₹${u.invoicedInr}`,
            )
            .join('\n'),
        source: SOURCE,
        dedupeKey: vasKey,
        metadata: {
          courierAccountId: account.id,
          count: vas.count,
          inr: vas.inr,
          items: vas.items.slice(0, 25).map((u) => ({ ...u })),
        },
      });
    } else {
      await this.issues.resolveByKey(vasKey, 'Every VAS charge old enough is on an invoice.');
    }

    const unreadable = result.rows.filter((r) => r.status === 'UNREADABLE');
    const failureKey = `shiprocket-invoice-check:${account.id}`;
    if (unreadable.length > 0) {
      await this.issues.raise({
        kind: SystemIssueKind.COURIER_COST_SYNC,
        severity: SystemIssueSeverity.MEDIUM,
        title: `${unreadable.length} Shiprocket invoice(s) could not be checked`,
        detail:
          'Their itemized file could not be had or read, so these invoices were not compared ' +
          'with the wallet:\n\n' +
          unreadable
            .map((r) => `${r.invoiceId} (${r.invoiceDate}) — ${r.problem ?? ''}`)
            .join('\n'),
        source: SOURCE,
        dedupeKey: failureKey,
        metadata: {
          courierAccountId: account.id,
          invoices: unreadable.map((r) => ({ invoiceId: r.invoiceId, problem: r.problem })),
        },
      });
    } else {
      await this.issues.resolveByKey(failureKey, 'Every Shiprocket invoice was read and checked.');
    }
  }

  private async finish(
    summary: ShiprocketInvoiceCheckSummary,
  ): Promise<ShiprocketInvoiceCheckSummary> {
    const failed = summary.accounts.filter((a) => a.outcome !== 'CHECKED').length;
    const allFailed = summary.accounts.length > 0 && failed === summary.accounts.length;
    const differing = summary.accounts.reduce(
      (n, a) => n + (a.result?.rows.filter((r) => r.status === 'DIFFERS').length ?? 0),
      0,
    );
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: allFailed ? ACTION_SR_INVOICES_FAILED : ACTION_SR_INVOICES_OK,
      entityType: 'courier',
      // A UUID column; the courier code goes in metadata.
      entityId: null,
      severity: failed > 0 || differing > 0 ? 'HIGH' : 'LOW',
      metadata: {
        courierCode: 'shiprocket',
        ...summary,
        accounts: summary.accounts.map((a) => ({ ...a })),
      },
    });
    this.logger.log(
      { accounts: summary.accounts.length, failed, differing, skipped: summary.skipped },
      'Shiprocket invoice check done',
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

function invoiceDetail(row: InvoiceCheckRow): string {
  const parts: string[] = [];
  if (row.totalsAgree === false) {
    parts.push(
      `Its itemized file adds up to ₹${row.itemizedInr ?? '?'}, not the ₹${row.totalInr} the invoice states.`,
    );
  }
  if (row.differenceCount > 0) {
    parts.push(
      `${row.differenceCount} order(s) billed differently from what the wallet charged ` +
        `(billed minus charged, overall: ₹${row.differenceInr}):\n` +
        row.differences
          .slice(0, 20)
          .map(
            (d) =>
              `order ${d.orderId || '(account)'} · ${d.service} · billed ₹${d.billedInr} · wallet charged ₹${d.walletInr}`,
          )
          .join('\n'),
    );
  }
  if (row.unknownServices.length > 0) {
    parts.push(
      `It bills services this check does not know how to match to the wallet: ` +
        `${row.unknownServices.join(', ')}. Add them to the service map before trusting it.`,
    );
  }
  parts.push(
    row.disputeOpen
      ? `Shiprocket settles a discrepancy only if it is raised within ${SR_DISPUTE_DAYS} days ` +
          `of the invoice date — by ${row.disputeBy}.`
      : `The ${SR_DISPUTE_DAYS}-day window to dispute it closed on ${row.disputeBy}; it is ` +
          'recorded so the pattern is visible.',
  );
  return parts.join('\n\n');
}

function groupedVas(items: InvoiceCheckResult['vasUninvoiced']['items']): string {
  const groups = new Map<string, { n: number; paise: number }>();
  for (const u of items) {
    const k = `${u.service}, ${u.lastChargedAt.slice(0, 7)}`;
    const g = groups.get(k) ?? { n: 0, paise: 0 };
    g.n += 1;
    g.paise += (decimalToPaise(u.chargedInr) ?? 0) - (decimalToPaise(u.invoicedInr) ?? 0);
    groups.set(k, g);
  }
  return [...groups]
    .map(([k, g]) => `${k}: ${g.n} charge(s), ₹${(g.paise / 100).toFixed(2)}`)
    .join('\n');
}
