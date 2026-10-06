import type { Page } from 'playwright';
import { gotoPortal } from './navigate';
import { applyLast90DaysPreset, type WalletWindow } from './wallet-date-range';

const FINANCES_PATH = '/finances/unified/transactions';

/**
 * How long Delhivery gets to produce the export after the click.
 *
 * NAMED, not raised. It was a bare `120_000` literal, and a bare
 * literal is how a figure chosen when the export was small fails years
 * later for a reason nobody connects to growth: the file is ~26,000
 * transactions now and climbing, Delhivery build it server-side, and
 * the whole window is one click with no progress to read.
 *
 * On 5 October 2026 this timeout fired in production. The value is
 * DELIBERATELY unchanged — raising a timeout to quiet a symptom nobody
 * has identified is how a real change (their button becoming a format
 * menu, say) gets masked for months. The failure now saves a screenshot
 * and the page text instead (`PortalFailureArtifactService`), so the
 * next occurrence can be diagnosed rather than guessed at. Move this
 * number only once a capture shows a download that was genuinely still
 * coming.
 */
const DOWNLOAD_WAIT_MS = 120_000;

/** The export's own button. Named because two places now look at it. */
const DOWNLOAD_BUTTON = /download ledger/i;

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
   * The caller decides how wide; this just asks for it — and is TOLD
   * whether the ask landed. `setDateRange`'s answer used to be dropped
   * on the floor, which made the "the caller is told" promise below
   * false: a picker that stopped working looked exactly like a picker
   * that worked, and the only symptom was a narrower export nobody
   * compared against what was requested.
   */
  async download(
    from: Date,
    to: Date,
  ): Promise<{ bytes: Buffer; rangeApplied: boolean; window: WalletWindow }> {
    await gotoPortal(this.page, `https://one.delhivery.com${FINANCES_PATH}`);

    // WHICH window, not only whether one took: the balance line read later
    // is compared against this file, and that comparison is only true
    // when both covered the same range.
    const window = await this.setDateRange(from, to);
    const rangeApplied = window === 'LAST_90_DAYS' || window === 'CUSTOM_RANGE';

    // Playwright must be waiting BEFORE the click — a download that
    // starts while nothing is listening is simply lost.
    //
    // WAIT ON THE CONTEXT, NOT THE PAGE. `page.waitForEvent('download')`
    // only ever fires for a download that THIS page started. If the
    // export is handed to a new tab — `target="_blank"`, or a
    // `window.open` the click performs — the download belongs to that
    // popup, and the wait on this page sits there until it times out
    // while the file arrives and is thrown away. The symptom is exactly
    // what we saw on 5 and 6 October: a button that is present, enabled
    // and single-match, a click that lands and takes focus, no dialog,
    // no error, and 120 seconds of nothing.
    //
    // The context sees downloads from every page in it, this one
    // included, so this is strictly broader than what it replaces and
    // costs nothing if the export never was a popup.
    const [download] = await Promise.all([
      this.page.context().waitForEvent('download', { timeout: DOWNLOAD_WAIT_MS }),
      this.page.getByRole('button', { name: DOWNLOAD_BUTTON }).first().click(),
    ]);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer));
    }
    return { bytes: Buffer.concat(chunks), rangeApplied, window };
  }

  /**
   * What the export control looks like RIGHT NOW.
   *
   * For the failure artefact, and it answers the question the timeout
   * cannot: "waiting for event download" says what we wanted, this says
   * what was there. A control that has become a menu reports
   * `aria-expanded`; one that is disabled or missing says so; and a
   * count above one means their page now has two of them and `.first()`
   * is clicking the wrong one.
   *
   * Reads only its own attributes and label, so nothing we hold can
   * reach the issue detail it is printed in.
   */
  async describeDownloadControl(): Promise<string> {
    const button = this.page.getByRole('button', { name: DOWNLOAD_BUTTON });
    const count = await button.count();
    if (count === 0) {
      // Their own label is gone. Say what buttons ARE there instead —
      // that is the whole diagnosis when a page has been redesigned.
      const names = await this.page
        .getByRole('button')
        .allInnerTexts()
        .catch(() => [] as string[]);
      const offered = names
        .map((n) => n.replace(/\s+/g, ' ').trim())
        .filter((n) => n !== '')
        .slice(0, 12);
      return `no "Download Ledger" button on the page; buttons present: ${
        offered.length === 0 ? 'none readable' : offered.join(' | ')
      }`;
    }
    const first = button.first();
    const [label, expanded, disabled, visible] = await Promise.all([
      first.innerText().catch(() => ''),
      first.getAttribute('aria-expanded').catch(() => null),
      first.isDisabled().catch(() => null),
      first.isVisible().catch(() => null),
    ]);
    return [
      `${count} match(es)`,
      `label "${label.replace(/\s+/g, ' ').trim()}"`,
      `aria-expanded=${expanded ?? '—'}`,
      `disabled=${disabled ?? '?'}`,
      `visible=${visible ?? '?'}`,
    ].join(', ');
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
  private async setDateRange(from: Date, to: Date): Promise<WalletWindow> {
    try {
      /*
        ── THE PRESET, NOT THE CALENDAR ──────────────────────────────

        Their picker is a list of named ranges — Today, Yesterday, This
        Week, … Last 90 Days, Custom — beside a month grid, and then a
        Done button. It has no `input[type="date"]` anywhere, which is
        why the old code below never applied anything: it looked for two
        date inputs, found none, and returned false. Every export came
        back at their default width while `rangeApplied: false` recorded
        the fact nightly and nobody read it.

        Clicking the named preset is also far more robust than driving a
        calendar to two arbitrary dates: one click, no month paging, and
        no chance of landing on the wrong year.

        Ninety days is as far back as the list goes, which is why the
        window setting is ninety and not more. The clicks live in
        `applyLast90DaysPreset`, shared with the balance read, because
        the two readings are compared and must take the same range.
      */
      const outcome = await applyLast90DaysPreset(this.page);
      if (outcome === 'APPLIED') return 'LAST_90_DAYS';
      if (outcome === 'NO_PICKER') return 'PAGE_DEFAULT';
      // NO_PRESET leaves the panel open; an open panel can sit over the
      // Download Ledger button. The date-input fallback below re-opens
      // whatever it needs.
      await this.page.keyboard.press('Escape').catch(() => undefined);

      /*
        FALLBACK: a pair of date inputs.

        Kept for the day they change the control back, or for an account
        whose panel differs. Not the primary path any more, and it is
        allowed to fail quietly — the export still downloads at their
        default width, which is a narrower window rather than a wrong
        one, and the caller is told through `rangeApplied`.
      */
      const iso = (d: Date): string => d.toISOString().slice(0, 10);
      const inputs = this.page.locator('input[type="date"]');
      if ((await inputs.count()) >= 2) {
        await inputs.nth(0).fill(iso(from));
        await inputs.nth(1).fill(iso(to));
        await this.page
          .getByRole('button', { name: /apply|done|ok/i })
          .first()
          .click()
          .catch(() => undefined);
        await this.page.waitForTimeout(1_500);
        return 'CUSTOM_RANGE';
      }
      return 'PAGE_DEFAULT';
    } catch {
      // A click failed part-way: we cannot say which range the page is
      // on, so this reading is never compared against another.
      return 'UNKNOWN';
    }
  }
}
