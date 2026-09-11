import type { Page } from 'playwright';
import {
  SR_PORTAL_ORIGIN,
  gotoShiprocket,
  isShiprocketLoginUrl,
} from '../services/shiprocket-portal-session.service';
import { SR_INVOICE_HEADERS, isInvoiceRow } from '../services/shiprocket-invoice-rows';

export class ShiprocketInvoicesPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShiprocketInvoicesPageError';
  }
}

/**
 * Far above their volume — 12 invoices in 90 days. `per_page` in the url
 * is honoured on the first page (measured on the wallet tabs, 2026-09-11),
 * and a window that ever fills it is REFUSED rather than read short.
 */
export const SR_INVOICE_PAGE_SIZE = 100;
/** An empty list is believed only after this many looks in a row with the loader gone. */
const EMPTY_READS_TO_BELIEVE = 4;

export interface ItemizedDownload {
  readonly body: Buffer;
  readonly contentType: string;
}

/**
 * Shiprocket's Invoices page (/seller/bills/invoices) and each invoice's
 * itemized download.
 *
 * ── WHAT IT READS, MEASURED 2026-09-11 ──────────────────────────────
 * The list is one table: Invoice Id · Service type · Invoice Date · Due
 * Date · Total · Status · Action. The same page also draws its date
 * picker's calendars as tables, so the invoice table is found by its
 * header rather than taken as "the first table". "View Invoice" opens the
 * invoice in a NEW TAB (srbs.shiprocket.in), whose "Download Now" link is
 * the itemized file: a zip of CSVs on S3 for VAS, a CSV for freight. The
 * link is fetched with a plain GET from the same browser context — it
 * carries its own token — so nothing is clicked that could change
 * anything on their side.
 *
 * ── WHAT IT REFUSES ─────────────────────────────────────────────────
 * A list read under their loading overlay (caught mid-draw, rows change
 * between two looks), one that landed on their login page, one whose
 * columns moved, and one that fills a whole page: each would be a
 * silently short or misread list, which the check would then call
 * "nothing to compare".
 */
export class ShiprocketInvoicesPage {
  constructor(private readonly page: Page) {}

  /** The invoice rows, dated between `from` and `to` (their "2026-Sep-11" form). */
  async list(from: string, to: string): Promise<string[][]> {
    await gotoShiprocket(
      this.page,
      `${SR_PORTAL_ORIGIN}/seller/bills/invoices?from=${from}&to=${to}` +
        `&current_page=1&per_page=${SR_INVOICE_PAGE_SIZE}`,
    );
    let previous: string | null = null;
    let emptyReads = 0;
    let seen = 'no invoice table';
    for (let i = 0; i < 60; i++) {
      await this.settle();
      this.assertSignedIn();
      const table = await this.table();
      if (table !== null) {
        this.assertHeaders(table.headers);
        if (table.rows.length === 0) {
          emptyReads += 1;
          if (emptyReads >= EMPTY_READS_TO_BELIEVE) return [];
        } else {
          emptyReads = 0;
          // Taken only when two looks in a row agree and every row is whole:
          // a list caught mid-draw differs from the next look.
          const key = JSON.stringify(table.rows);
          if (table.rows.every(isInvoiceRow) && key === previous) {
            if (table.rows.length >= SR_INVOICE_PAGE_SIZE || (await this.hasNextPage())) {
              throw new ShiprocketInvoicesPageError(
                `the invoice list fills more than one page (${table.rows.length} rows) — ` +
                  'refusing a partial list; shorten the window',
              );
            }
            return table.rows;
          }
          previous = key;
          seen = `${table.rows.length} rows, still changing`;
        }
      }
      await this.page.waitForTimeout(700);
    }
    throw new ShiprocketInvoicesPageError(`the invoice list never finished drawing (${seen})`);
  }

  /**
   * One invoice's itemized file, or null when its view offers none (a
   * subscription invoice has only the PDF). Opens the view in their new
   * tab, reads the link, closes the tab.
   */
  async itemizedFile(invoiceId: string): Promise<ItemizedDownload | null> {
    const row = this.page.locator('table tbody tr', { hasText: invoiceId }).first();
    if ((await row.count()) === 0) {
      throw new ShiprocketInvoicesPageError(`${invoiceId} is not on the invoice list any more`);
    }
    const opened = this.page.context().waitForEvent('page', { timeout: 20_000 });
    await row.getByText('View Invoice').first().click({ timeout: 15_000 });
    const view = await opened;
    try {
      await view.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined);
      if (isShiprocketLoginUrl(view.url())) {
        throw new ShiprocketInvoicesPageError(
          'the Shiprocket session has expired (landed on login)',
        );
      }
      const link = view.locator('a', { hasText: /^\s*Download Now\s*$/ }).first();
      const found = await link
        .waitFor({ state: 'attached', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!found) return null;
      const href = await link.getAttribute('href');
      if (href === null || href.trim() === '') return null;
      const res = await view
        .context()
        .request.get(new URL(href, view.url()).toString(), { timeout: 90_000 });
      if (!res.ok()) {
        throw new ShiprocketInvoicesPageError(
          `${invoiceId}: their itemized file answered HTTP ${res.status()}`,
        );
      }
      return { body: await res.body(), contentType: res.headers()['content-type'] ?? '' };
    } finally {
      await view.close().catch(() => undefined);
    }
  }

  private assertSignedIn(): void {
    if (isShiprocketLoginUrl(this.page.url())) {
      throw new ShiprocketInvoicesPageError('the Shiprocket session has expired (landed on login)');
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

  private assertHeaders(found: readonly string[]): void {
    const want = SR_INVOICE_HEADERS;
    if (found.length !== want.length || found.some((h, i) => h !== want[i])) {
      throw new ShiprocketInvoicesPageError(
        `their invoice columns changed — expected ${want.join(' | ')}, found ${found.join(' | ')}`,
      );
    }
  }

  private async hasNextPage(): Promise<boolean> {
    const cls = await this.page
      .locator('.pagination-container .next-btn')
      .first()
      .getAttribute('class', { timeout: 3_000 })
      .catch(() => null);
    return cls !== null && !/btndisable/.test(cls);
  }

  /** The table whose header names "Invoice Id" — never a calendar. */
  private table(): Promise<{ headers: string[]; rows: string[][] } | null> {
    return this.page.$$eval('table', (tables) => {
      const text = (n: unknown): string =>
        (n as { innerText: string }).innerText.replace(/\s+/g, ' ').trim();
      for (const t of tables) {
        const headers = Array.from(t.querySelectorAll('thead th'))
          .map(text)
          .filter((h) => h !== '');
        if (!headers.includes('Invoice Id')) continue;
        const rows = Array.from(t.querySelectorAll('tbody tr'))
          .map((tr) =>
            Array.from(
              (tr as { querySelectorAll(s: string): ArrayLike<unknown> }).querySelectorAll('td'),
            ).map(text),
          )
          .filter((r) => r.length > 2);
        return { headers, rows };
      }
      return null;
    });
  }
}
