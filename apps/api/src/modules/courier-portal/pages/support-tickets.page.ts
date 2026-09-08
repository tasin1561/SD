import { createHash } from 'node:crypto';
import type { Page } from 'playwright';
import { gotoPortal } from './navigate';

/** Which of their tabs a ticket is sitting in. */
export type PortalTicketState = 'OPEN' | 'RESOLVED';

export interface PortalTicketRow {
  /** Their id as a person reads it: `J1788584000522861`. */
  readonly externalTicketId: string;
  /** The waybill printed under the id. Null when the row shows none. */
  readonly awbNumber: string | null;
  readonly state: PortalTicketState;
  /**
   * A hash of the whole row as it reads today.
   *
   * Whether the thread is worth opening. Not a parsed timestamp — the
   * question is "has anything about this changed", and the whole row
   * answers it without teaching us their date format.
   */
  readonly rowHash: string;
}

export interface PortalTicketScan {
  readonly rows: readonly PortalTicketRow[];
  /**
   * Did EVERY page of BOTH tabs read cleanly?
   *
   * Load-bearing, because absence is how closure is inferred: a ticket
   * of ours that is in neither tab has been closed. On a partial scan
   * that reasoning inverts into a catastrophe — a login bounce returns
   * zero rows, every ticket looks absent, and every seller's ticket gets
   * closed at once. So closure is inferred ONLY when this is true.
   */
  readonly complete: boolean;
  /** Their own stated total per tab, for the sanity check. */
  readonly statedTotals: Readonly<Record<string, number | null>>;
  /**
   * Why a tab could not be read, per tab.
   *
   * The catch below used to discard the error, so an incomplete scan
   * was reported as `{"open":null,"resolved":null}` and 0 rows with no
   * hint of the cause — which is a watchdog that has noticed something
   * and cannot say what. It fired for a navigation race that took
   * seconds to diagnose once the message was in hand.
   */
  readonly errors: Readonly<Record<string, string>>;
}

const TICKET_ID_RE = /\bJ\d{12,20}\b/;
const AWB_RE = /\b\d{11,14}\b/;
/** "Showing 1 - 30 of 206" */
const TOTAL_RE = /Showing\s*([\d,]+)\s*-\s*([\d,]+)\s*of\s*([\d,]+)/i;

/** Only these two. See `listOpenAndResolved`. */
const TABS: ReadonlyArray<{ path: string; state: PortalTicketState }> = [
  { path: 'open', state: 'OPEN' },
  { path: 'resolved', state: 'RESOLVED' },
];

/** Their pagination is a Vue component with stable class names. */
const NEXT = 'a.ap-pagination__next';
const DISABLED = 'ap-pagination__link--disabled';

/**
 * Delhivery ONE's support list.
 *
 * ── OPEN AND RESOLVED. NEVER CLOSED ──────────────────────────────────
 * Three tabs exist and only two are read. A ticket of ours that is in
 * neither has been closed, which is the same conclusion the Closed tab
 * would have given — reached by NOT looking rather than by paging
 * through it. That matters because Closed grows without bound while Open
 * and Resolved are bounded by how much work is outstanding: today 206
 * and 30-odd, against a Closed tab that will hold every ticket the
 * account ever raised.
 *
 * The inference has one dangerous failure and it is guarded, not hoped
 * about: a scan that did not complete makes everything look absent. An
 * expired session bounces to /v2/login and returns zero rows — observed,
 * not imagined — and acting on that would close every seller's ticket in
 * one sweep. `PortalTicketScan.complete` is what the caller must check.
 *
 * ── EVERY PAGE, BY CLICKING ──────────────────────────────────────────
 * `?page=2` is ignored: their pagination is client-side and the URL
 * never changes. The per-page select offers exactly one option, 30, so
 * there is no way to ask for a bigger page either. What works is
 * clicking `a.ap-pagination__next` until it carries
 * `ap-pagination__link--disabled`.
 *
 * The first version read whatever was on screen and stopped — 30 rows of
 * 206, silently missing 176 tickets and reporting a clean sweep.
 *
 * ── TWO IDS, AND THERE IS NO LINK BETWEEN THEM ───────────────────────
 * `J1788584000522861` is what the list prints and what a person quotes.
 * The detail lives at `/support/<uuid>`, and NOTHING on the list carries
 * it: the id is a `<span class="text-cta-primary cursor-pointer">` with
 * a click handler, not an anchor. So opening one means clicking it.
 *
 * VERIFIED against one.delhivery.com on 2026-09-06: the table, the row
 * text, both tab URLs, the pagination markup, the stated totals, and the
 * click-through.
 */
export class SupportTicketsPage {
  constructor(
    private readonly page: Page,
    private readonly origin = 'https://one.delhivery.com',
  ) {}

  /**
   * Every ticket in Open and Resolved, across every page.
   *
   * `maxPages` is a runaway guard, not a limit anybody should hit: 206
   * tickets is 7 pages, so 40 leaves an order of magnitude of headroom
   * and still stops a broken "next" button from looping until the job
   * times out.
   */
  async listOpenAndResolved(maxPages = 40): Promise<PortalTicketScan> {
    const rows: PortalTicketRow[] = [];
    const statedTotals: Record<string, number | null> = {};
    const errors: Record<string, string> = {};
    let complete = true;

    for (const tab of TABS) {
      try {
        const res = await this.scanTab(tab.path, tab.state, maxPages);
        rows.push(...res.rows);
        statedTotals[tab.path] = res.statedTotal;
        // Their own count against ours. A tab that says 206 and yields
        // 30 has stopped paginating somewhere, and treating that as a
        // full read is what closes 176 tickets that are simply on page
        // two.
        if (res.statedTotal !== null && res.rows.length < res.statedTotal) complete = false;
        if (!res.pagedToEnd) complete = false;
      } catch (err) {
        complete = false;
        statedTotals[tab.path] = null;
        // KEPT, not swallowed. The alarm downstream is the only place
        // anybody learns this happened, and "it did not finish" without
        // a reason sends them to read logs on a droplet.
        errors[tab.path] = err instanceof Error ? err.message : String(err);
      }
    }
    return { rows, complete, statedTotals, errors };
  }

  private async scanTab(
    path: string,
    state: PortalTicketState,
    maxPages: number,
  ): Promise<{ rows: PortalTicketRow[]; statedTotal: number | null; pagedToEnd: boolean }> {
    await gotoPortal(this.page, `${this.origin}/support/support-tickets/${path}`);
    await this.settle();

    const rows: PortalTicketRow[] = [];
    const seen = new Set<string>();
    const statedTotal = await this.statedTotal();
    let pagedToEnd = false;

    for (let pageNo = 0; pageNo < maxPages; pageNo += 1) {
      rows.push(...(await this.rowsOnScreen(state, seen)));

      const next = this.page.locator(NEXT).first();
      if ((await next.count()) === 0) {
        pagedToEnd = true;
        break;
      }
      const cls = (await next.getAttribute('class')) ?? '';
      if (cls.includes(DISABLED)) {
        pagedToEnd = true;
        break;
      }
      await next.click();
      // Their table re-renders in place; a settle plus a beat is what
      // separates "page two" from "page one read twice". The dedup on
      // ticket id is the belt to that brace.
      await this.settle();
      await this.page.waitForTimeout(800);
    }
    return { rows, statedTotal, pagedToEnd };
  }

  private async rowsOnScreen(
    state: PortalTicketState,
    seen: Set<string>,
  ): Promise<PortalTicketRow[]> {
    const trs = this.page.locator('tr, [role="row"]');
    const n = await trs.count();
    const out: PortalTicketRow[] = [];
    for (let i = 0; i < n; i += 1) {
      const text = (
        await trs
          .nth(i)
          .innerText()
          .catch(() => '')
      ).trim();
      if (text === '') continue;
      const id = TICKET_ID_RE.exec(text)?.[0];
      if (id === undefined || seen.has(id)) continue;
      seen.add(id);
      // The waybill is read from the text AFTER the id is removed, so a
      // ticket id's own digits can never be mistaken for one.
      const awb = AWB_RE.exec(text.replace(id, ' '))?.[0] ?? null;
      out.push({
        externalTicketId: id,
        awbNumber: awb,
        state,
        rowHash: createHash('sha256').update(text.replace(/\s+/g, ' ')).digest('hex').slice(0, 32),
      });
    }
    return out;
  }

  /** "Showing 1 - 30 of 206" → 206. Null when they do not say. */
  private async statedTotal(): Promise<number | null> {
    const text = await this.page
      .locator('.ap-pagination__perpage')
      .first()
      .innerText()
      .catch(() => '');
    const m = TOTAL_RE.exec(text.replace(/\s+/g, ' '));
    const raw = m?.[3]?.replace(/,/g, '');
    return raw === undefined ? null : Number(raw);
  }

  /**
   * Open one ticket's thread by clicking its id.
   *
   * Their id is a span with a click handler, so this is the only way in.
   * Returns the detail URL their router lands on, or null — if the route
   * never changes we did not open the ticket, and reading whatever is on
   * screen would attach one ticket's messages to another.
   */
  async openByTicketId(externalTicketId: string, tab: string): Promise<string | null> {
    await gotoPortal(this.page, `${this.origin}/support/support-tickets/${tab}`);
    await this.settle();

    // Their search is what makes this affordable: the ticket may be on
    // page six, and paging to it would cost as much as the whole scan.
    const search = this.page.locator('input[placeholder*="ticket" i]').first();
    if ((await search.count()) > 0) {
      await search.fill(externalTicketId);
      await search.press('Enter');
      await this.settle();
      await this.page.waitForTimeout(800);
    }

    const link = this.page.locator(`span:text-is("${externalTicketId}")`).first();
    if ((await link.count()) === 0) return null;
    await link.click();

    try {
      await this.page.waitForURL(/\/support\/[0-9a-f-]{20,}/, { timeout: 30_000 });
    } catch {
      return null;
    }
    return this.page.url();
  }

  private async settle(): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  }
}

/** Their tab path, for going back to the row that was in it. */
export const TAB_PATH: Readonly<Record<PortalTicketState, string>> = {
  OPEN: 'open',
  RESOLVED: 'resolved',
};
