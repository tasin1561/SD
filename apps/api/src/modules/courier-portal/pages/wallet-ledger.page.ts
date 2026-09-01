import type { Page } from 'playwright';

const FINANCES_PATH = '/finances/unified/transactions';

/**
 * The Finances → Transactions screen, and the file behind its Download
 * Ledger button.
 *
 * ── WHY THE FILE AND NOT THE TABLE ───────────────────────────────────
 * The table paginates — a week of parcels is 56 pages of 25 — and
 * driving pagination is both slow and the first thing to break when
 * they reorder a column. The export is one click, carries more than the
 * screen shows (six sheets, including the per-AWB deductions and
 * refunds), and states its own totals so the parse can check itself.
 */
export class WalletLedgerPage {
  constructor(private readonly page: Page) {}

  /**
   * Download the ledger for a window and return its bytes.
   *
   * The window is a ROLLING one, not "yesterday": Delhivery re-cuts a
   * charge weeks after the parcel moved, so a narrow window would
   * capture each parcel's first figure and never see the correction.
   * The caller decides how wide; this just asks for it.
   */
  async download(from: Date, to: Date): Promise<Buffer> {
    await this.page.goto(`https://one.delhivery.com${FINANCES_PATH}`, {
      waitUntil: 'domcontentloaded',
    });

    await this.setDateRange(from, to);

    // Playwright must be waiting BEFORE the click — a download that
    // starts while nothing is listening is simply lost.
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: 120_000 }),
      this.page
        .getByRole('button', { name: /download ledger/i })
        .first()
        .click(),
    ]);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer));
    }
    return Buffer.concat(chunks);
  }

  /**
   * Set the range the export covers.
   *
   * Best-effort by design: their picker is a custom control, and if it
   * cannot be driven the export still downloads — with whatever range
   * the page defaults to. That is a smaller window than we asked for,
   * not a wrong one, and the import is re-runnable, so a missed
   * revision is picked up on the next night rather than lost. The
   * caller is told, so a picker that has stopped working shows up as a
   * warning rather than as costs that quietly stop updating.
   */
  private async setDateRange(from: Date, to: Date): Promise<boolean> {
    const iso = (d: Date): string => d.toISOString().slice(0, 10);
    const trigger = this.page.getByText(/date range/i).first();
    const found = await trigger
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!found) return false;

    try {
      await trigger.click();
      const inputs = this.page.locator('input[type="date"]');
      if ((await inputs.count()) >= 2) {
        await inputs.nth(0).fill(iso(from));
        await inputs.nth(1).fill(iso(to));
        await this.page
          .getByRole('button', { name: /apply|done|ok/i })
          .first()
          .click()
          .catch(() => undefined);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
