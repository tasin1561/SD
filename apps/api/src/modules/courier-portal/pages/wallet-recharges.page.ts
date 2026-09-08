import type { Page } from 'playwright';
import { gotoPortal } from './navigate';

export interface PortalWalletBalance {
  readonly balanceInr: string;
  readonly totalCreditInr: string | null;
  readonly totalDebitInr: string | null;
}

export interface PortalRecharge {
  /** THEIR id — `MRC17885146743279740`. */
  readonly externalTxnId: string;
  /** The BANK's own reference — `164531411356`. What we match on. */
  readonly bankTxnRef: string | null;
  readonly amountInr: string;
  readonly status: string;
  readonly occurredAt: Date;
}

const FINANCES = '/finances/unified/transactions';
const RECHARGES = '/finances/unified/recharges';

/** `MRC` + a long run of digits. */
const TXN_RE = /\bMRC\d{10,30}\b/;
/** A plain digit run that is NOT part of their MRC id. */
const BANK_REF_RE = /\b\d{8,20}\b/;
/** "₹ 20,000.00" or "₹20,000.00". */
const MONEY_RE = /₹\s?([\d,]+(?:\.\d{1,2})?)/;
/** "9:37 am 4 Sept, 2026" — their row prints the time before the date. */
const WHEN_RE = /(\d{1,2}):(\d{2})\s*(am|pm)\s*(\d{1,2})\s*([A-Za-z]{3,9}),?\s*(\d{4})/i;

const MONTHS: Readonly<Record<string, number>> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/**
 * Delhivery's wallet: what it holds, and what has been put into it.
 *
 * ── WHY THE RECHARGES MATTER MORE THAN THE BALANCE ───────────────────
 * The balance answers "will parcels keep booking". The RECHARGE LIST
 * answers a harder question: did every rupee in that wallet leave one of
 * our bank accounts, and did every rupee that left our bank accounts
 * arrive. Their wallet is prepaid, so those two are the whole of our
 * exposure to it, and nothing was checking either.
 *
 * ── THE BANK'S REFERENCE IS WHAT MAKES MATCHING EXACT ────────────────
 * Each row carries the BANK's transaction id next to theirs. So a
 * recharge can be tied to our own bank entry by reference rather than by
 * amount and date — which would pair two ₹20,000 recharges made on the
 * same morning arbitrarily and report both as reconciled.
 *
 * The id is read FIRST and removed from the row before the bank
 * reference is looked for: `MRC17885146743279740` contains a long digit
 * run of its own, and a bank-reference pattern applied to the raw row
 * would find that instead.
 *
 * VERIFIED against one.delhivery.com on 2026-09-06: both URLs, the
 * balance line ("Current Balance ₹ 4,206.79 Total Credit … Total Debit
 * …"), and the recharge row shape (their id, time, date, bank id,
 * status, amount).
 */
export class WalletRechargesPage {
  constructor(
    private readonly page: Page,
    private readonly origin = 'https://one.delhivery.com',
  ) {}

  /**
   * What the wallet holds right now, plus their own running totals.
   *
   * The totals are kept because a balance that disagrees with credits
   * minus debits means something is missing from the list they showed
   * us — which is the one failure a per-row reconciliation cannot see.
   */
  async readBalance(): Promise<PortalWalletBalance | null> {
    await gotoPortal(this.page, `${this.origin}${FINANCES}`);
    await this.settle();
    const text = (await this.page.locator('body').innerText()).replace(/\s+/g, ' ');

    const balance = /Current Balance\s*₹\s?([\d,]+(?:\.\d{1,2})?)/i.exec(text)?.[1];
    if (balance === undefined) return null;
    return {
      balanceInr: balance.replace(/,/g, ''),
      totalCreditInr:
        /Total Credit\s*₹\s?([\d,]+(?:\.\d{1,2})?)/i.exec(text)?.[1]?.replace(/,/g, '') ?? null,
      totalDebitInr:
        /Total Debit\s*₹\s?([\d,]+(?:\.\d{1,2})?)/i.exec(text)?.[1]?.replace(/,/g, '') ?? null,
    };
  }

  /** Every recharge their list is showing, across every page. */
  async listRecharges(maxPages = 40): Promise<PortalRecharge[]> {
    await gotoPortal(this.page, `${this.origin}${RECHARGES}`);
    await this.settle();

    const out: PortalRecharge[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < maxPages; i += 1) {
      const rows = this.page.locator('tr, [role="row"]');
      const n = await rows.count();
      for (let r = 0; r < n; r += 1) {
        const parsed = this.parseRow(
          (
            await rows
              .nth(r)
              .innerText()
              .catch(() => '')
          ).trim(),
        );
        if (parsed === null || seen.has(parsed.externalTxnId)) continue;
        seen.add(parsed.externalTxnId);
        out.push(parsed);
      }

      const next = this.page.locator('a.ap-pagination__next').first();
      if ((await next.count()) === 0) break;
      const cls = (await next.getAttribute('class')) ?? '';
      if (cls.includes('ap-pagination__link--disabled')) break;
      await next.click();
      await this.settle();
      await this.page.waitForTimeout(800);
    }
    return out;
  }

  /** Exported shape kept private: one row of their table. */
  parseRow(raw: string): PortalRecharge | null {
    const text = raw.replace(/\s+/g, ' ').trim();
    const externalTxnId = TXN_RE.exec(text)?.[0];
    if (externalTxnId === undefined) return null;

    // Their id removed BEFORE the bank reference is looked for — it
    // carries a long digit run of its own.
    const rest = text.replace(externalTxnId, ' ');
    const amountRaw = MONEY_RE.exec(rest)?.[1];
    if (amountRaw === undefined) return null;
    // And the amount removed before the reference, for the same reason.
    const withoutAmount = rest.replace(MONEY_RE, ' ');

    const when = WHEN_RE.exec(withoutAmount);
    const occurredAt = when === null ? null : this.toDate(when);
    if (occurredAt === null) return null;

    const bankTxnRef = BANK_REF_RE.exec(withoutAmount.replace(WHEN_RE, ' '))?.[0] ?? null;
    const status = /\b(Success|Failed|Pending|Processing)\b/i.exec(rest)?.[1] ?? 'Unknown';

    return {
      externalTxnId,
      bankTxnRef,
      amountInr: amountRaw.replace(/,/g, ''),
      status,
      occurredAt,
    };
  }

  /**
   * Their "9:37 am 4 Sept, 2026" as an instant.
   *
   * Built in IST and converted, not parsed as local: the droplet runs
   * UTC, and reading their timestamp as UTC would place every morning
   * recharge five and a half hours early — enough to land it on the
   * previous day and mismatch a date-bounded reconciliation.
   */
  private toDate(m: RegExpExecArray): Date | null {
    const month = MONTHS[(m[5] ?? '').slice(0, 3).toLowerCase()];
    if (month === undefined) return null;
    let hour = Number(m[1]);
    if ((m[3] ?? '').toLowerCase() === 'pm' && hour !== 12) hour += 12;
    if ((m[3] ?? '').toLowerCase() === 'am' && hour === 12) hour = 0;
    const utcMs = Date.UTC(Number(m[6]), month, Number(m[4]), hour, Number(m[2]));
    return new Date(utcMs - 5.5 * 60 * 60 * 1000);
  }

  private async settle(): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout: 25_000 }).catch(() => undefined);
    await this.page
      .locator('.ap-loading__overlay')
      .waitFor({ state: 'detached', timeout: 20_000 })
      .catch(() => undefined);
    await this.page.waitForTimeout(1_500);
  }
}
