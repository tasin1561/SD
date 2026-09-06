import type { Page } from 'playwright';

/** Which of their three tabs a ticket is sitting in. */
export type PortalTicketState = 'OPEN' | 'RESOLVED' | 'CLOSED';

/** Their tab path, for going back to the row that was in it. */
export const TAB_PATH: Readonly<Record<PortalTicketState, string>> = {
  OPEN: 'open',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
};

export interface PortalTicketRow {
  /** Their id as a person reads it: `J1788584000522861`. */
  readonly externalTicketId: string;
  /** The waybill printed under the id. Null when the row shows none. */
  readonly awbNumber: string | null;
  readonly state: PortalTicketState;
}

const TICKET_ID_RE = /\bJ\d{12,20}\b/;
const AWB_RE = /\b\d{11,14}\b/;

const TABS: ReadonlyArray<{ path: string; state: PortalTicketState }> = [
  { path: 'open', state: 'OPEN' },
  { path: 'resolved', state: 'RESOLVED' },
  { path: 'closed', state: 'CLOSED' },
];

/**
 * Delhivery ONE's support list — the three tabs, and what is in them.
 *
 * ── THE ONLY PLACE THAT KNOWS A TICKET'S STATE ───────────────────────
 * Their ticket detail page shows a status pill, but the LIST is what
 * partitions Open / Resolved / Closed, and the partition is the fact we
 * need: "has Delhivery finished with this" is answered by which tab the
 * row is in, not by parsing a word out of a page.
 *
 * ── AND THE ONLY PLACE THAT BINDS AN ID TO A PARCEL ──────────────────
 * Raising a ticket does not reliably hand back its id — the modal
 * confirms and closes. The list prints the id and the waybill together,
 * which is what lets a ticket we raised minutes ago be matched to the
 * escalation that raised it. Without this, every raise would be a write
 * we could never read back.
 *
 * ── TWO IDS, AND THERE IS NO LINK BETWEEN THEM ───────────────────────
 * `J1788584000522861` is what the list prints and what a person quotes.
 * The detail page lives at `/support/<uuid>`, a different identifier
 * entirely — and NOTHING on the list carries it. The id is a
 * `<span class="text-cta-primary cursor-pointer">` with a click handler,
 * not an anchor, so there is no href to read and no route that accepts
 * the J-id.
 *
 * That was found by probing the real portal, and it mattered: the first
 * version read `a[href*="/support/"]`, got null on every row, and would
 * have swept three tabs, matched every ticket and opened none of them —
 * silently, reporting a clean run every twenty minutes.
 *
 * So opening one means CLICKING it and then waiting for their router to
 * land, which is what `openByTicketId` does.
 *
 * VERIFIED against one.delhivery.com on 2026-09-06: the table, the row
 * text (id, waybill, email, category, subcategory, dates, status), the
 * three tab URLs, and the click-through.
 */
export class SupportTicketsPage {
  constructor(
    private readonly page: Page,
    private readonly origin = 'https://one.delhivery.com',
  ) {}

  /**
   * Every ticket across all three tabs.
   *
   * All three every time, deliberately: a ticket that moved from Open to
   * Closed since the last sweep is exactly the event worth catching, and
   * reading only the open tab would make a closure look like a ticket
   * that had vanished.
   */
  async listAll(maxPerTab = 200): Promise<PortalTicketRow[]> {
    const out: PortalTicketRow[] = [];
    for (const tab of TABS) {
      out.push(...(await this.listTab(tab.path, tab.state, maxPerTab)));
    }
    return out;
  }

  private async listTab(
    path: string,
    state: PortalTicketState,
    max: number,
  ): Promise<PortalTicketRow[]> {
    await this.page.goto(`${this.origin}/support/support-tickets/${path}`, {
      waitUntil: 'domcontentloaded',
    });
    await this.page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);

    const rows = this.page.locator('tr, [role="row"]');
    const n = Math.min(await rows.count(), max);
    const out: PortalTicketRow[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < n; i += 1) {
      const row = rows.nth(i);
      const text = (await row.innerText().catch(() => '')).trim();
      if (text === '') continue;
      const id = TICKET_ID_RE.exec(text)?.[0];
      if (id === undefined || seen.has(id)) continue;
      seen.add(id);

      // The waybill is read from the text AFTER the id is removed, so a
      // ticket id's own digits can never be mistaken for one.
      const awb = AWB_RE.exec(text.replace(id, ' '))?.[0] ?? null;
      out.push({ externalTicketId: id, awbNumber: awb, state });
    }
    return out;
  }

  /**
   * Open one ticket's thread by clicking its id.
   *
   * Their id is a span with a click handler, so this is the only way in.
   * Returns the detail URL their router lands on — the caller stores it
   * so a later read can go straight there instead of walking the list
   * again.
   *
   * Returns null rather than assuming: if the route never changes we did
   * not open the ticket, and reading whatever is on screen would attach
   * one ticket's messages to another.
   */
  async openByTicketId(externalTicketId: string, tab: string): Promise<string | null> {
    await this.page.goto(`${this.origin}/support/support-tickets/${tab}`, {
      waitUntil: 'domcontentloaded',
    });
    await this.page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);

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
}
