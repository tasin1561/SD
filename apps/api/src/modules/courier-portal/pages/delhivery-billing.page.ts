import type { Download, Page } from 'playwright';
import { gotoPortal } from './navigate';
import {
  ProbeBudgetExhausted,
  judgeClick,
  judgeNavigation,
  type BudgetKind,
  type ClickCandidate,
  type ProbeBudget,
} from '../services/portal-read-only-guard';
import { pickInvoiceRows, redactUrl } from '../services/delhivery-billing-probe-files';

export const DELHIVERY_ORIGIN = 'https://one.delhivery.com';
/** A page the wallet sync signs in to every night — known to exist. */
const START_PATH = '/finances/unified/transactions';
/** Tried only when no link on the pages we saw names billing or invoices. */
const GUESSED_PATHS = [
  '/finances/unified/invoices',
  '/finances/invoices',
  '/finances/unified/billing',
  '/billing/invoices',
  '/finances/unified/statements',
];
const BILLING_RX = /invoice|billing|\bbills?\b|statement/i;
const INVOICE_TAB_RX = /^(tax\s+)?invoices?$|^billing$|^bills$|invoices?\b/i;
const DOWNLOAD_RX =
  /download|export|csv|xlsx?|excel|annexure|itemi[sz]ed|breakup|break-up|details?|zip|pdf|\bview\b/i;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TEXT = 200_000;
const MAX_LINKS_PER_PAGE = 80;
const MAX_LIST_ROWS = 60;
/** Per invoice: the itemized file, and the PDF beside it if there is one. */
const FILES_PER_INVOICE = 2;

export interface TableFinding {
  readonly index: number;
  readonly headers: readonly string[];
  readonly rowCount: number;
  readonly sampleRows: readonly (readonly string[])[];
}

export interface PageFinding {
  /** Why the probe went there. */
  readonly why: string;
  /** Query values removed — a url can carry a token. */
  readonly url: string;
  readonly title: string;
  readonly landedOnLogin: boolean;
  readonly headings: readonly string[];
  readonly menu: readonly string[];
  readonly buttons: readonly string[];
  readonly links: readonly { readonly text: string; readonly url: string }[];
  readonly tables: readonly TableFinding[];
}

export interface RawPage {
  readonly finding: PageFinding;
  readonly screenshot: Buffer | null;
  readonly text: string;
}

export interface InvoiceListFinding {
  readonly pageUrl: string;
  readonly headers: readonly string[];
  readonly rowCount: number;
  readonly rows: readonly (readonly string[])[];
  /** What each of the first rows offers to click, by label. */
  readonly rowControls: readonly {
    readonly row: number;
    readonly controls: readonly { readonly label: string; readonly href: string | null }[];
  }[];
  /** True when their "Last 90 days" preset was applied; null when there was no picker. */
  readonly rangeApplied: boolean | null;
  readonly picks: readonly {
    readonly rowIndex: number;
    readonly reason: string;
    readonly cells: readonly string[];
  }[];
}

export interface RawDownload {
  readonly forRow: number | null;
  readonly control: string;
  readonly via: 'download' | 'href' | 'popup-link' | 'menu';
  readonly fileName: string;
  readonly contentType: string | null;
  readonly sourceUrl: string | null;
  /** Null when the file was larger than the cap; `bytes` still says how large. */
  readonly body: Buffer | null;
  readonly bytes: number;
}

export interface Attempt {
  readonly forRow: number | null;
  readonly control: string;
  readonly outcome: string;
}

export interface RawExploration {
  readonly pages: readonly RawPage[];
  readonly invoiceList: InvoiceListFinding | null;
  readonly downloads: readonly RawDownload[];
  readonly attempts: readonly Attempt[];
  readonly refused: readonly { readonly label: string; readonly reason: string }[];
  readonly notFound: readonly string[];
  readonly stoppedBy: BudgetKind | null;
  readonly error: string | null;
}

interface Control {
  readonly id: string;
  readonly label: string;
  readonly href: string | null;
  readonly tag: string;
}

interface RawTable {
  readonly headers: string[];
  readonly rowCount: number;
  readonly rows: { cells: string[]; controls: Control[] }[];
}

interface Snapshot {
  readonly finding: PageFinding;
  readonly rawLinks: readonly { text: string; href: string }[];
  readonly tables: readonly RawTable[];
}

/*
  Browser-side helpers, passed as SOURCE. This package compiles without the
  DOM lib (see PortalSessionService.dismissResetPasswordModal), so the code
  that runs in the page is a string rather than a typed function.

  `labelOf` is what the guard judges: the element's own text, value,
  aria-label, title, alt, test id, and the names of any icon inside it — an
  icon-only button is often named only by its icon's class ("download",
  "trash"), and that is exactly the word the guard needs to see.
*/
const LIB = `
  var clip = function (s, n) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim().slice(0, n); };
  var vis = function (el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  var labelOf = function (el) {
    var parts = [el.innerText, el.getAttribute('value'), el.getAttribute('aria-label'), el.getAttribute('title'),
      el.getAttribute('alt'), el.getAttribute('data-testid')];
    if (/^(svg|img|i)$/i.test(el.tagName)) parts.push(el.getAttribute('class'), el.getAttribute('data-icon'));
    var kids = el.querySelectorAll('svg, img, i, use');
    for (var k = 0; k < kids.length && k < 6; k++) {
      var c = kids[k];
      parts.push(c.getAttribute('aria-label'), c.getAttribute('data-icon'), c.getAttribute('alt'),
        c.getAttribute('title'), c.getAttribute('data-testid'), c.getAttribute('class'));
    }
    return clip(parts.filter(function (p) { return p; }).join(' '), 160);
  };
  var tagEl = function (el) {
    window.__sdProbeSeq = (window.__sdProbeSeq || 0) + 1;
    var id = 'p' + window.__sdProbeSeq;
    el.setAttribute('data-sd-probe', id);
    return id;
  };
  var uniq = function (a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); };
`;

const SNAPSHOT_JS = `(function () { ${LIB}
  var headings = uniq(Array.prototype.slice.call(document.querySelectorAll('h1, h2, h3, h4, [role="heading"]'))
    .filter(vis).map(function (h) { return clip(h.innerText, 120); }).filter(Boolean)).slice(0, 40);
  var links = Array.prototype.slice.call(document.querySelectorAll('a[href]')).slice(0, 400)
    .map(function (a) { return { text: labelOf(a), href: a.href }; });
  var menu = uniq(Array.prototype.slice.call(document.querySelectorAll(
      'nav a, nav button, aside a, aside button, [role="menuitem"], [role="tab"], [role="navigation"] a'))
    .filter(vis).map(labelOf).filter(Boolean)).slice(0, 150);
  var buttons = uniq(Array.prototype.slice.call(document.querySelectorAll(
      'button, [role="button"], input[type="button"], input[type="submit"]'))
    .filter(vis).map(labelOf).filter(Boolean)).slice(0, 150);
  return { title: document.title, headings: headings, links: links, menu: menu, buttons: buttons };
})()`;

const TABLES_JS = `(function () { ${LIB}
  var out = [];
  var ts = Array.prototype.slice.call(document.querySelectorAll('table, [role="table"], [role="grid"]')).filter(vis);
  for (var t = 0; t < ts.length && out.length < 10; t++) {
    var el = ts[t];
    if (el.parentElement && el.parentElement.closest('table, [role="table"], [role="grid"]')) continue;
    var headers = Array.prototype.slice.call(el.querySelectorAll('thead th, [role="columnheader"]'))
      .map(function (h) { return clip(h.innerText, 80); });
    var rowEls = Array.prototype.slice.call(el.querySelectorAll('tbody tr'));
    if (rowEls.length === 0) {
      rowEls = Array.prototype.slice.call(el.querySelectorAll('[role="row"]'))
        .filter(function (r) { return !r.querySelector('[role="columnheader"]'); });
    }
    var rows = [];
    for (var r = 0; r < rowEls.length && r < 80; r++) {
      var re = rowEls[r];
      var cells = Array.prototype.slice.call(re.querySelectorAll('td, [role="cell"], [role="gridcell"]'))
        .map(function (c) { return clip(c.innerText, 150); });
      var controls = [];
      var cand = Array.prototype.slice.call(re.querySelectorAll('a, button, [role="button"], [role="link"], svg, img, i'));
      for (var c = 0; c < cand.length && controls.length < 12; c++) {
        var x = cand[c];
        var host = x.parentElement ? x.parentElement.closest('a, button, [role="button"], [role="link"]') : null;
        if (host && re.contains(host)) continue;
        if (/^(svg|img|i)$/i.test(x.tagName)) {
          var pointer = getComputedStyle(x).cursor === 'pointer' ||
            (x.parentElement && getComputedStyle(x.parentElement).cursor === 'pointer');
          if (!pointer) continue;
        }
        controls.push({ id: tagEl(x), label: labelOf(x), href: x.getAttribute('href'), tag: x.tagName.toLowerCase() });
      }
      rows.push({ cells: cells, controls: controls });
    }
    out.push({ headers: headers.slice(0, 40), rowCount: rowEls.length, rows: rows });
  }
  return out;
})()`;

/** Tag every visible element under `selector` whose label matches. */
function tagAllJs(selector: string, rx: RegExp, cap: number): string {
  return `(function () { ${LIB}
    var rx = new RegExp(${JSON.stringify(rx.source)}, 'i');
    var out = [];
    var els = Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(selector)})).filter(vis);
    for (var i = 0; i < els.length && out.length < ${cap}; i++) {
      var l = labelOf(els[i]);
      if (!rx.test(l)) continue;
      out.push({ id: tagEl(els[i]), label: l, href: els[i].getAttribute('href'), tag: els[i].tagName.toLowerCase() });
    }
    return out;
  })()`;
}

/** Tag the MOST SPECIFIC visible element whose label matches — the shortest label. */
function tagByTextJs(selector: string, rx: RegExp): string {
  return `(function () { ${LIB}
    var rx = new RegExp(${JSON.stringify(rx.source)}, 'i');
    var best = null; var bestLabel = '';
    var els = Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(selector)})).filter(vis);
    for (var i = 0; i < els.length; i++) {
      var l = labelOf(els[i]);
      if (!rx.test(l)) continue;
      if (best === null || l.length < bestLabel.length) { best = els[i]; bestLabel = l; }
    }
    if (best === null) return null;
    return { id: tagEl(best), label: bestLabel, href: best.getAttribute('href'), tag: best.tagName.toLowerCase() };
  })()`;
}

function candidateJs(id: string): string {
  return `(function () { ${LIB}
    var el = document.querySelector('[data-sd-probe="${id}"]');
    if (!el) return null;
    return { label: labelOf(el), tag: el.tagName.toLowerCase(),
      type: String(el.getAttribute('type') || '').toLowerCase(), inForm: !!el.closest('form') };
  })()`;
}

const isLoginUrl = (u: string): boolean => /\/v2\/login|signin|ucp-auth/i.test(u);
const pathOf = (u: string): string => {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname.replace(/\/$/, '')}`;
  } catch {
    return u;
  }
};
const isDelhivery = (u: string): boolean => {
  try {
    return /(^|\.)delhivery\.com$/i.test(new URL(u).hostname);
  } catch {
    return false;
  }
};

/** First non-null of several waits, or null once all have given up. */
function firstOf<T>(waits: readonly Promise<T | null>[]): Promise<T | null> {
  return new Promise((resolve) => {
    let left = waits.length;
    const miss = (): void => {
      left -= 1;
      if (left === 0) resolve(null);
    };
    for (const w of waits) {
      w.then((v) => (v === null ? miss() : resolve(v)), miss);
    }
  });
}

function fileNameFrom(disposition: string | undefined, url: string): string {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? '');
  if (m?.[1] !== undefined) return decodeURIComponent(m[1]);
  try {
    return new URL(url).pathname.split('/').pop() || 'download';
  } catch {
    return 'download';
  }
}

/**
 * Delhivery ONE's billing area, discovered rather than assumed.
 *
 * ── NOTHING HERE HAS BEEN SEEN ───────────────────────────────────────
 * Unlike every other page object in this folder, this one is written
 * BEFORE anybody has looked at the page. So it guesses nothing it cannot
 * check: it starts on the Finances page the cost sync already reads,
 * records the menus, headings, buttons, links and tables of every page it
 * visits, follows links that name billing or invoices, tries an
 * "Invoices" tab, and only then a short list of guessed urls. A table is
 * the invoice list only if one of its headers says "invoice". Whatever it
 * cannot find is NAMED in `notFound` rather than papered over — the point
 * of the run is to show a person what is there.
 *
 * ── READ-ONLY ────────────────────────────────────────────────────────
 * It navigates (GET), reads, and downloads. Every click is judged by
 * `judgeClick` against the element's own label; every url by
 * `judgeNavigation`. It never types into anything and never submits a
 * form. The only key it presses is Escape, to close a menu it opened.
 */
export class DelhiveryBillingPage {
  private readonly pages: RawPage[] = [];
  private readonly downloads: RawDownload[] = [];
  private readonly attempts: Attempt[] = [];
  private readonly refused: { label: string; reason: string }[] = [];
  private readonly notFound: string[] = [];
  private readonly visited = new Set<string>();

  constructor(
    private readonly page: Page,
    private readonly budget: ProbeBudget,
  ) {}

  async explore(): Promise<RawExploration> {
    let invoiceList: InvoiceListFinding | null = null;
    let stoppedBy: BudgetKind | null = null;
    let error: string | null = null;
    try {
      this.page.setDefaultTimeout(20_000);
      const found = await this.findInvoiceList();
      if (found === null) {
        this.notFound.push(
          'No table with an "invoice" column on any page visited. The menus, links and ' +
            'screenshots of every page are recorded — the invoices are elsewhere, or not a table.',
        );
      } else {
        invoiceList = found.finding;
        await this.downloadPicks(found.finding, found.table, found.listUrl);
      }
    } catch (err) {
      if (err instanceof ProbeBudgetExhausted) stoppedBy = err.kind;
      else error = (err instanceof Error ? err.message : String(err)).slice(0, 400);
    }
    return {
      pages: this.pages,
      invoiceList,
      downloads: this.downloads,
      attempts: this.attempts,
      refused: this.refused,
      notFound: this.notFound,
      stoppedBy,
      error,
    };
  }

  // ── Finding the list ──────────────────────────────────────────────────

  private async findInvoiceList(): Promise<{
    finding: InvoiceListFinding;
    table: RawTable;
    listUrl: string;
  } | null> {
    const start = await this.visit(
      `${DELHIVERY_ORIGIN}${START_PATH}`,
      'start: the Finances page the cost sync reads',
    );
    if (start !== null) {
      const hit = await this.listOn(start);
      if (hit !== null) return hit;
      const tab = await this.tryInvoiceTab();
      if (tab !== null) return tab;
    }

    const seen = new Set<string>();
    const fromLinks = (start?.rawLinks ?? [])
      .filter((l) => isDelhivery(l.href) && (BILLING_RX.test(l.text) || BILLING_RX.test(l.href)))
      .map((l) => ({ url: l.href, why: `a link on the Finances page reading "${l.text}"` }));
    const guesses = GUESSED_PATHS.map((p) => ({
      url: `${DELHIVERY_ORIGIN}${p}`,
      why: 'a guessed url (no link named it)',
    }));
    for (const c of [...fromLinks, ...guesses]) {
      if (seen.has(pathOf(c.url))) continue;
      seen.add(pathOf(c.url));
      const snap = await this.visit(c.url, c.why);
      if (snap === null) continue;
      const hit = await this.listOn(snap);
      if (hit !== null) return hit;
      const tab = await this.tryInvoiceTab();
      if (tab !== null) return tab;
      // Links on a billing page may lead one level deeper.
      for (const l of snap.rawLinks) {
        if (
          isDelhivery(l.href) &&
          BILLING_RX.test(`${l.text} ${l.href}`) &&
          !seen.has(pathOf(l.href))
        ) {
          fromLinks.push({ url: l.href, why: `a link on ${redactUrl(c.url)} reading "${l.text}"` });
        }
      }
    }
    return null;
  }

  /** An "Invoices" tab on the current page, clicked through the guard. */
  private async tryInvoiceTab(): Promise<{
    finding: InvoiceListFinding;
    table: RawTable;
    listUrl: string;
  } | null> {
    const tab = await this.tagOne(
      '[role="tab"], button, [role="button"], li, [role="menuitem"]',
      INVOICE_TAB_RX,
    );
    if (tab === null || tab.href !== null) return null; // a link is visited, not clicked
    this.budget.takePage();
    if (!(await this.guardedClick(tab.id))) return null;
    await this.settle();
    const snap = await this.snapshot(`tab: "${tab.label}"`);
    return this.listOn(snap);
  }

  private async listOn(snap: Snapshot): Promise<{
    finding: InvoiceListFinding;
    table: RawTable;
    listUrl: string;
  } | null> {
    let table = this.invoiceTable(snap.tables);
    if (table === null) return null;
    const listUrl = this.page.url();
    const rangeApplied = await this.tryNinetyDays();
    if (rangeApplied === true) {
      this.budget.takePage();
      const again = await this.snapshot('the invoice list after choosing "Last 90 days"');
      table = this.invoiceTable(again.tables) ?? table;
    }
    const cells = table.rows.map((r) => r.cells);
    const picks = pickInvoiceRows(table.headers, cells);
    return {
      table,
      listUrl,
      finding: {
        pageUrl: redactUrl(listUrl),
        headers: table.headers,
        rowCount: table.rowCount,
        rows: cells.slice(0, MAX_LIST_ROWS),
        rowControls: table.rows.slice(0, 5).map((r, row) => ({
          row,
          controls: r.controls.map((c) => ({
            label: c.label,
            href: c.href === null ? null : redactUrl(this.absolute(c.href)),
          })),
        })),
        rangeApplied,
        picks: picks.map((p) => ({ ...p, cells: cells[p.rowIndex] ?? [] })),
      },
    };
  }

  private invoiceTable(tables: readonly RawTable[]): RawTable | null {
    const scored = tables
      .map((t) => {
        const h = t.headers.join(' | ');
        let score = /invoice/i.test(h) ? 3 : 0;
        if (/amount|total/i.test(h)) score += 1;
        if (/date|period|month/i.test(h)) score += 1;
        return { t, score };
      })
      .filter((s) => s.score >= 3)
      .sort((a, b) => b.score - a.score || b.t.rowCount - a.t.rowCount);
    return scored[0]?.t ?? null;
  }

  /**
   * Their date picker's "Last 90 days" preset, as the wallet page uses it.
   * Null when there is no picker; false when there is one we could not set.
   */
  private async tryNinetyDays(): Promise<boolean | null> {
    const trigger = await this.tagOne(
      'button, [role="button"], div, span',
      /date\s*range|select\s*date|last\s+\d+\s+days|this\s+month/,
    );
    if (trigger === null) return null;
    if (!(await this.guardedClick(trigger.id))) return false;
    await this.page.waitForTimeout(800);
    const preset = await this.tagOne(
      'li, button, [role="option"], [role="menuitem"], div, span',
      /^last\s*(90\s*days|3\s*months)$/,
    );
    if (preset === null || !(await this.guardedClick(preset.id))) {
      await this.page.keyboard.press('Escape').catch(() => undefined);
      return false;
    }
    await this.page.waitForTimeout(500);
    const done = await this.tagOne('button, [role="button"]', /^(done|ok)$/);
    if (done !== null) await this.guardedClick(done.id);
    await this.settle();
    return true;
  }

  // ── Downloading ───────────────────────────────────────────────────────

  private async downloadPicks(
    list: InvoiceListFinding,
    firstTable: RawTable,
    listUrl: string,
  ): Promise<void> {
    let table: RawTable | null = firstTable;
    for (const [n, pick] of list.picks.entries()) {
      if (n > 0) table = await this.reloadList(listUrl, list.rangeApplied === true);
      const row = table?.rows.find((r) => r.cells.join('|') === pick.cells.join('|'));
      if (row === undefined) {
        this.attempts.push({
          forRow: pick.rowIndex,
          control: '(row)',
          outcome: 'the row could not be found again after returning to the list',
        });
        continue;
      }
      const ordered = [...row.controls]
        .filter((c) => DOWNLOAD_RX.test(c.label) || (c.href !== null && c.href.trim() !== ''))
        .sort((a, b) => Number(/pdf/i.test(a.label)) - Number(/pdf/i.test(b.label)));
      if (ordered.length === 0) {
        this.attempts.push({
          forRow: pick.rowIndex,
          control: '(none)',
          outcome: `nothing on the row reads as a download; it offers: ${
            row.controls.map((c) => `"${c.label}"`).join(', ') || 'no controls at all'
          }`,
        });
        continue;
      }
      let got = 0;
      for (const c of ordered.slice(0, 4)) {
        if (got >= FILES_PER_INVOICE) break;
        got += await this.tryControl(c, pick.rowIndex, 0);
      }
    }
  }

  private async reloadList(listUrl: string, rangeApplied: boolean): Promise<RawTable | null> {
    this.visited.delete(pathOf(listUrl));
    const snap = await this.visit(listUrl, 'back to the invoice list for the next invoice');
    if (snap === null) return null;
    if (rangeApplied && (await this.tryNinetyDays()) === true) {
      this.budget.takePage();
      return this.invoiceTable((await this.snapshot('the list again, last 90 days')).tables);
    }
    return this.invoiceTable(snap.tables);
  }

  /** One control → how many files it produced. */
  private async tryControl(c: Control, forRow: number | null, depth: number): Promise<number> {
    const href = c.href?.trim() ?? '';
    if (href !== '' && !/^(#|javascript:)/i.test(href)) {
      const abs = this.absolute(href);
      const appRoute =
        new URL(abs).origin === DELHIVERY_ORIGIN && !/\.(pdf|csv|xlsx?|zip)(\?|$)/i.test(abs);
      if (!appRoute) return (await this.fetchHref(abs, forRow, c.label, 'href')) ? 1 : 0;
      if (depth > 0) {
        this.attempts.push({
          forRow,
          control: c.label,
          outcome: 'a second-level page link, not followed',
        });
        return 0;
      }
      const snap = await this.visit(abs, `the page behind "${c.label}" on row ${forRow ?? '-'}`);
      return snap === null ? 0 : this.downloadsOnPage(forRow);
    }
    return this.clickForFile(c, forRow, depth);
  }

  /** On an invoice's own page: every download-looking control, through the guard. */
  private async downloadsOnPage(forRow: number | null): Promise<number> {
    const controls = await this.tagAll('a, button, [role="button"]', DOWNLOAD_RX, 8);
    controls.sort((a, b) => Number(/pdf/i.test(a.label)) - Number(/pdf/i.test(b.label)));
    let got = 0;
    for (const pc of controls.slice(0, 4)) {
      if (got >= FILES_PER_INVOICE) break;
      got += await this.tryControl(pc, forRow, 1);
    }
    if (controls.length === 0) {
      this.attempts.push({
        forRow,
        control: '(page)',
        outcome: 'the page offers nothing that reads as a download',
      });
    }
    return got;
  }

  private async clickForFile(c: Control, forRow: number | null, depth: number): Promise<number> {
    this.budget.takeDownload();
    const before = pathOf(this.page.url());
    const ctx = this.page.context();
    const waitDownload = this.page
      .waitForEvent('download', { timeout: 15_000 })
      .then((d): { kind: 'download'; d: Download } => ({ kind: 'download', d }))
      .catch(() => null);
    const waitPopup = ctx
      .waitForEvent('page', { timeout: 15_000 })
      .then((p): { kind: 'popup'; p: Page } => ({ kind: 'popup', p }))
      .catch(() => null);
    if (!(await this.guardedClick(c.id))) return 0;
    const event = await firstOf<{ kind: 'download'; d: Download } | { kind: 'popup'; p: Page }>([
      waitDownload,
      waitPopup,
    ]);

    if (event?.kind === 'download') {
      await this.keepDownload(event.d, forRow, c.label, depth > 0 ? 'menu' : 'download');
      return 1;
    }
    if (event?.kind === 'popup') return this.readPopup(event.p, forRow, c.label);

    // Nothing arrived. Either the click routed the app somewhere, or it
    // opened a menu / dialog offering formats.
    if (pathOf(this.page.url()) !== before) {
      if (depth > 0) return 0;
      this.budget.takePage();
      await this.settle();
      await this.snapshot(`where "${c.label}" on row ${forRow ?? '-'} led`);
      return this.downloadsOnPage(forRow);
    }
    if (depth > 0) {
      this.attempts.push({
        forRow,
        control: c.label,
        outcome: 'clicked; nothing downloaded or opened',
      });
      return 0;
    }
    const options = await this.tagAll(
      '[role="menuitem"], [role="option"], [role="dialog"] button, [role="dialog"] a, ' +
        '.ant-dropdown-menu-item, .MuiMenuItem-root',
      /./,
      12,
    );
    this.attempts.push({
      forRow,
      control: c.label,
      outcome:
        options.length === 0
          ? 'clicked; nothing downloaded, opened or appeared'
          : `clicked; it offered: ${options.map((o) => `"${o.label}"`).join(', ')}`,
    });
    let got = 0;
    for (const o of options.filter((x) => DOWNLOAD_RX.test(x.label)).slice(0, 3)) {
      if (got >= FILES_PER_INVOICE) break;
      got += await this.clickForFile(o, forRow, depth + 1);
    }
    await this.page.keyboard.press('Escape').catch(() => undefined);
    return got;
  }

  private async readPopup(p: Page, forRow: number | null, control: string): Promise<number> {
    try {
      await p.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined);
      const url = p.url();
      // A popup straight onto a file (a PDF viewer) is fetched as the file.
      if (/\.(pdf|csv|xlsx?|zip)(\?|$)/i.test(url)) {
        return (await this.fetchHref(url, forRow, control, 'popup-link')) ? 1 : 0;
      }
      this.budget.takePage();
      await p.waitForTimeout(3_000);
      const text = await p
        .locator('body')
        .innerText({ timeout: 15_000 })
        .catch(() => '');
      const screenshot = await p.screenshot({ fullPage: true, timeout: 20_000 }).catch(() => null);
      const links = ((await p.evaluate(tagAllJs('a[href]', DOWNLOAD_RX, 6))) ?? []) as Control[];
      this.pages.push({
        finding: {
          why: `the tab "${control}" opened`,
          url: redactUrl(url),
          title: await p.title().catch(() => ''),
          landedOnLogin: isLoginUrl(url),
          headings: [],
          menu: [],
          buttons: [],
          links: links.map((l) => ({
            text: l.label,
            url: redactUrl(this.absolute(l.href ?? '', url)),
          })),
          tables: [],
        },
        screenshot,
        text: text.slice(0, MAX_TEXT),
      });
      let got = 0;
      for (const l of links.slice(0, FILES_PER_INVOICE)) {
        if (l.href === null) continue;
        if (await this.fetchHref(this.absolute(l.href, url), forRow, l.label, 'popup-link'))
          got += 1;
      }
      if (links.length === 0) {
        this.attempts.push({
          forRow,
          control,
          outcome: `opened ${redactUrl(url)}; it offers no download link`,
        });
      }
      return got;
    } finally {
      await p.close().catch(() => undefined);
    }
  }

  /** A plain GET, from the signed-in context. A GET changes nothing. */
  private async fetchHref(
    url: string,
    forRow: number | null,
    control: string,
    via: RawDownload['via'],
  ): Promise<boolean> {
    const verdict = judgeNavigation(url);
    if (!verdict.allowed) {
      this.refused.push({ label: redactUrl(url), reason: verdict.reason });
      return false;
    }
    this.budget.takeDownload();
    const res = await this.page
      .context()
      .request.get(url, { timeout: 90_000 })
      .catch((err: unknown) => {
        this.attempts.push({
          forRow,
          control,
          outcome: `GET ${redactUrl(url)} failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`,
        });
        return null;
      });
    if (res === null) return false;
    if (!res.ok()) {
      this.attempts.push({
        forRow,
        control,
        outcome: `GET ${redactUrl(url)} answered HTTP ${res.status()}`,
      });
      return false;
    }
    const headers = res.headers();
    const body = await res.body();
    this.downloads.push({
      forRow,
      control,
      via,
      fileName: fileNameFrom(headers['content-disposition'], url),
      contentType: headers['content-type'] ?? null,
      sourceUrl: redactUrl(url),
      body: body.length > MAX_FILE_BYTES ? null : body,
      bytes: body.length,
    });
    return true;
  }

  private async keepDownload(
    d: Download,
    forRow: number | null,
    control: string,
    via: RawDownload['via'],
  ): Promise<void> {
    const stream = await d.createReadStream();
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of stream) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer);
      bytes += b.length;
      if (bytes <= MAX_FILE_BYTES) chunks.push(b);
    }
    this.downloads.push({
      forRow,
      control,
      via,
      fileName: d.suggestedFilename(),
      contentType: null,
      sourceUrl: d.url() === '' ? null : redactUrl(d.url()),
      body: bytes > MAX_FILE_BYTES ? null : Buffer.concat(chunks),
      bytes,
    });
  }

  // ── Primitives ────────────────────────────────────────────────────────

  private async visit(url: string, why: string): Promise<Snapshot | null> {
    const verdict = judgeNavigation(url);
    if (!verdict.allowed) {
      this.refused.push({ label: redactUrl(url), reason: verdict.reason });
      return null;
    }
    if (this.visited.has(pathOf(url))) return null;
    this.visited.add(pathOf(url));
    this.budget.takePage();
    try {
      await gotoPortal(this.page, url);
    } catch (err) {
      this.notFound.push(
        `${redactUrl(url)} did not load: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`,
      );
      return null;
    }
    await this.settle();
    const snap = await this.snapshot(why);
    if (snap.finding.landedOnLogin) {
      throw new Error(
        `the Delhivery session did not hold — ${redactUrl(url)} landed on their login page`,
      );
    }
    return snap;
  }

  private async settle(): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await this.page.waitForTimeout(1_500);
  }

  private async snapshot(why: string): Promise<Snapshot> {
    this.budget.checkTime();
    const url = this.page.url();
    const raw = (await this.page.evaluate(SNAPSHOT_JS)) as {
      title: string;
      headings: string[];
      links: { text: string; href: string }[];
      menu: string[];
      buttons: string[];
    };
    const tables = ((await this.page.evaluate(TABLES_JS)) ?? []) as RawTable[];
    const text = await this.page
      .locator('body')
      .innerText({ timeout: 15_000 })
      .catch(() => '');
    const screenshot = await this.page
      .screenshot({ fullPage: true, timeout: 20_000 })
      .catch(() => null);
    const finding: PageFinding = {
      why,
      url: redactUrl(url),
      title: raw.title,
      landedOnLogin: isLoginUrl(url),
      headings: raw.headings,
      menu: raw.menu,
      buttons: raw.buttons,
      links: raw.links
        .filter((l) => isDelhivery(l.href))
        .slice(0, MAX_LINKS_PER_PAGE)
        .map((l) => ({ text: l.text.slice(0, 80), url: redactUrl(l.href) })),
      tables: tables.map((t, index) => ({
        index,
        headers: t.headers,
        rowCount: t.rowCount,
        sampleRows: t.rows.slice(0, 5).map((r) => r.cells),
      })),
    };
    this.pages.push({ finding, screenshot, text: text.slice(0, MAX_TEXT) });
    return { finding, rawLinks: raw.links, tables };
  }

  /**
   * THE ONLY WAY THIS CLASS CLICKS. Reads the element's own label, type
   * and form membership in the page, and refuses anything `judgeClick`
   * does not allow — recorded, never thrown, because a refusal is a
   * finding and the rest of the run is still worth having.
   */
  private async guardedClick(id: string): Promise<boolean> {
    const info = (await this.page.evaluate(candidateJs(id))) as ClickCandidate | null;
    if (info === null) return false;
    const verdict = judgeClick(info);
    if (!verdict.allowed) {
      this.refused.push({ label: info.label, reason: verdict.reason });
      return false;
    }
    try {
      await this.page.locator(`[data-sd-probe="${id}"]`).first().click({ timeout: 10_000 });
      return true;
    } catch (err) {
      this.attempts.push({
        forRow: null,
        control: info.label,
        outcome: `could not click: ${(err instanceof Error ? err.message : String(err)).slice(0, 120)}`,
      });
      return false;
    }
  }

  private async tagOne(selector: string, rx: RegExp): Promise<Control | null> {
    return ((await this.page.evaluate(tagByTextJs(selector, rx))) ?? null) as Control | null;
  }

  private async tagAll(selector: string, rx: RegExp, cap: number): Promise<Control[]> {
    return ((await this.page.evaluate(tagAllJs(selector, rx, cap))) ?? []) as Control[];
  }

  private absolute(href: string, base = this.page.url()): string {
    try {
      return new URL(href, base).toString();
    } catch {
      return href;
    }
  }
}
