import type { Page } from 'playwright';
import {
  SR_PORTAL_ORIGIN,
  gotoShiprocket,
  isShiprocketLoginUrl,
} from '../services/shiprocket-portal-session.service';

export type ShiprocketWalletTab = 'passbook' | 'ledger' | 'recharge-history';

export class ShiprocketWalletPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShiprocketWalletPageError';
  }
}

/**
 * Each tab's columns, as their page names them. Checked on every read: a
 * page whose columns moved is a different page, and reading its cells by
 * position would put the balance where the amount belongs.
 */
export const SR_WALLET_HEADERS: Readonly<Record<ShiprocketWalletTab, readonly string[]>> = {
  passbook: [
    'Transaction Date',
    'Order ID',
    'AWB Code',
    'Transaction Type',
    'Sub Category',
    'Description',
    'Amount (₹)',
    'Available Balance (₹)',
  ],
  ledger: [
    'Date',
    'Transaction Date',
    'Particulars',
    'Debit (₹)',
    'Credit (₹)',
    'Description',
    'Available Balance (₹)',
  ],
  'recharge-history': [
    'Transaction Date',
    'Transaction ID',
    'Amount (₹)',
    'Status',
    'Payment Mode',
    'Description',
  ],
};

/** "11 Sep, 2026 07:10 PM" (passbook) or "03 Sep, 2026" (ledger, recharges). */
const ROW_DATE = /^\d{2} [A-Z][a-z]{2}, \d{4}(?: \d{2}:\d{2} [AP]M)?$/;
const PAGE_SIZE = 100;
/** Far above 90 days at their volume (~65 pages); a runaway loop stops here. */
const MAX_PAGES = 400;
/** An empty table is believed only after this many looks in a row with the loader gone. */
const EMPTY_READS_TO_BELIEVE = 4;

/** A row is only accepted fully drawn: the right number of cells and a date. */
export function isCompleteRow(tab: ShiprocketWalletTab, row: readonly string[]): boolean {
  return row.length === SR_WALLET_HEADERS[tab].length && ROW_DATE.test(row[0] ?? '');
}

/**
 * One wallet tab of Shiprocket's seller panel, read as rows of text.
 *
 * ── HOW THEIR PAGE PAGES, MEASURED 2026-09-11 ────────────────────────
 * The url's `current_page` is ignored — their app resets it to 1 — and
 * `per_page` is honoured only on the FIRST page: "Next" falls back to 15
 * rows. Choosing 100 in their own page-size menu holds across Next, at
 * about two seconds a page, so that is what this does.
 *
 * ── WHAT IT REFUSES TO RETURN ────────────────────────────────────────
 * Between pages they draw a loading overlay, and a read taken under it
 * returns a half-drawn table (blank dates, a handful of rows). Taken at
 * face value that is a silently SHORT ledger — the one failure the whole
 * import is built to avoid — so each page is waited for until every row
 * is complete AND it differs from the page before, and a page that comes
 * back short while "Next" is still enabled is an error, not a last page.
 * A bounce to their login page is an error too: an empty table read off
 * a login screen would look like a quiet day.
 */
export class ShiprocketWalletPage {
  constructor(private readonly page: Page) {}

  async readTab(tab: ShiprocketWalletTab, from: string, to: string): Promise<string[][]> {
    const url =
      `${SR_PORTAL_ORIGIN}/seller/wallet-transactions/${tab}` +
      `?from=${from}&to=${to}&current_page=1`;
    await gotoShiprocket(this.page, url);
    await this.page
      .locator('.finance-tbl-wrapper table')
      .first()
      .waitFor({ state: 'visible', timeout: 45_000 })
      .catch(() => undefined);
    this.assertSignedIn();
    await this.settle();
    await this.assertHeaders(tab);

    if (!(await this.nextDisabled())) await this.choosePageSize();

    const rows: string[][] = [];
    let previousFirst: string | null = null;
    for (let n = 1; n <= MAX_PAGES; n++) {
      const pageRows = await this.waitForPage(tab, previousFirst);
      if (pageRows.length === 0) {
        // Empty only after it STAYED empty with their loader gone (see
        // waitForPage). On page one that is an empty window; later, it is
        // the page after the last — their Next does not always grey out.
        return rows;
      }
      rows.push(...pageRows);
      previousFirst = JSON.stringify(pageRows[0]);
      const last = await this.nextDisabled();
      if (last) return rows;

      await this.settle();
      await this.page.locator('.pagination-container .next-btn').first().click({ timeout: 20_000 });

      if (pageRows.length !== PAGE_SIZE) {
        /*
          A SHORT page with "Next" still enabled. On Recharge History that
          is simply the last page — measured 2026-09-11: 27 rows at 100 a
          page, Next enabled, and pressing it drew an empty table. So it is
          PROVED rather than assumed: the page after it must be empty. If a
          real page appears instead, the short one was a partial read and
          the whole tab is refused — importing a short ledger is the one
          failure this reader exists to prevent.
        */
        const after = await this.waitForPage(tab, previousFirst);
        if (after.length === 0) return rows;
        throw new ShiprocketWalletPageError(
          `${tab}: page ${n} has ${pageRows.length} rows while more pages follow — refusing a ` +
            'partial read rather than importing a short ledger',
        );
      }
    }
    throw new ShiprocketWalletPageError(`${tab}: more than ${MAX_PAGES} pages — stopped`);
  }

  /** Their "Current Usable Balance" tile, as a decimal string. */
  async readUsableBalance(): Promise<string | null> {
    const text = await this.page.locator('body').innerText({ timeout: 15_000 });
    const m = /Current Usable Balance\s*₹\s*(-?[\d,]+\.\d{2})/.exec(text);
    return m?.[1]?.replace(/,/g, '') ?? null;
  }

  private assertSignedIn(): void {
    if (isShiprocketLoginUrl(this.page.url())) {
      throw new ShiprocketWalletPageError('the Shiprocket session has expired (landed on login)');
    }
  }

  private async settle(): Promise<void> {
    await this.page
      .locator('ngx-ui-loader .loading-foreground')
      .first()
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
    await this.page.waitForTimeout(400);
  }

  private async assertHeaders(tab: ShiprocketWalletTab): Promise<void> {
    const found = (
      await this.page.$$eval('.finance-tbl-wrapper table thead th', (ths) =>
        ths.map((th) =>
          (th as unknown as { innerText: string }).innerText.replace(/\s+/g, ' ').trim(),
        ),
      )
    ).filter((h) => h !== '');
    const want = SR_WALLET_HEADERS[tab];
    if (found.length !== want.length || found.some((h, i) => h !== want[i])) {
      throw new ShiprocketWalletPageError(
        `${tab}: their columns changed — expected ${want.join(' | ')}, found ${found.join(' | ')}`,
      );
    }
  }

  private async choosePageSize(): Promise<void> {
    await this.page.locator('.new-p-s-btn').first().click({ timeout: 15_000 });
    await this.page.waitForTimeout(600);
    await this.page
      .locator('.mat-mdc-menu-item', { hasText: new RegExp(`^\\s*${PAGE_SIZE}\\s*$`) })
      .first()
      .click({ timeout: 15_000 });
  }

  private async nextDisabled(): Promise<boolean> {
    const cls = await this.page
      .locator('.pagination-container .next-btn')
      .first()
      .getAttribute('class', { timeout: 5_000 })
      .catch(() => null);
    // No pager at all means one page.
    return cls === null || /btndisable/.test(cls);
  }

  private async rows(): Promise<string[][]> {
    return this.page.$$eval('.finance-tbl-wrapper table tbody tr', (trs) =>
      trs
        .map((tr) =>
          Array.from(tr.querySelectorAll('td')).map((td) =>
            (td as unknown as { innerText: string }).innerText.replace(/\s+/g, ' ').trim(),
          ),
        )
        // Their table interleaves a one-cell spacer row with every row.
        .filter((r) => r.length > 2),
    );
  }

  /**
   * Rows once the page is fully drawn and is not the page before — or an
   * empty list, but only once the table has STAYED empty with their loader
   * gone. A table caught mid-load is also empty, and taking that for "no
   * more rows" would cut the oldest movements off the read; the balance
   * chain could not see it, because nothing is missing BETWEEN the rows
   * that were read.
   */
  private async waitForPage(
    tab: ShiprocketWalletTab,
    previousFirst: string | null,
  ): Promise<string[][]> {
    let rows: string[][] = [];
    let emptyReads = 0;
    for (let i = 0; i < 60; i++) {
      await this.settle();
      this.assertSignedIn();
      rows = await this.rows();
      if (rows.length === 0) {
        emptyReads += 1;
        if (emptyReads >= EMPTY_READS_TO_BELIEVE) return [];
      } else {
        emptyReads = 0;
        const complete = rows.every((r) => isCompleteRow(tab, r));
        if (complete && JSON.stringify(rows[0]) !== previousFirst) return rows;
      }
      await this.page.waitForTimeout(500);
    }
    throw new ShiprocketWalletPageError(
      `${tab}: the table never finished drawing (${rows.length} rows, some incomplete or repeated)`,
    );
  }
}
