import type { Page } from 'playwright';

/** Which of their three tabs a ticket is sitting in. */
export type PortalTicketState = 'OPEN' | 'RESOLVED' | 'CLOSED';

export interface PortalTicketRow {
  /** Their id as a person reads it: `J1788584000522861`. */
  readonly externalTicketId: string;
  /** The waybill printed under the id. Null when the row shows none. */
  readonly awbNumber: string | null;
  readonly state: PortalTicketState;
  /** Where the thread lives. Their detail URL is a UUID, not the J-id. */
  readonly href: string | null;
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
 * ── TWO IDS, AND THEY ARE NOT THE SAME ID ────────────────────────────
 * `J1788584000522861` is what the list prints and what a person quotes.
 * The detail page lives at `/support/<uuid>`, a different identifier
 * entirely. So the row carries BOTH: the J-id to store and match on, the
 * href to navigate by. Storing only the J-id would leave us able to
 * recognise a ticket and unable to open it.
 *
 * TODO(delhivery-portal): the URLs, the tab names and the id shapes are
 * from the real portal (2026-09-06). The row-level DOM is inferred —
 * every locator is anchored on visible text for that reason.
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
      const href = await row
        .locator('a[href*="/support/"]')
        .first()
        .getAttribute('href')
        .catch(() => null);

      out.push({ externalTicketId: id, awbNumber: awb, state, href });
    }
    return out;
  }

  /** Open one ticket's thread, by the href the list gave us. */
  async openDetail(href: string): Promise<void> {
    const url = href.startsWith('http') ? href : `${this.origin}${href}`;
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  }
}
