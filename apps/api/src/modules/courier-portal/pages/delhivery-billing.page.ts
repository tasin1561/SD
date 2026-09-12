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
import {
  classifyListRows,
  latestPerServiceType,
  latestRow,
  namesAFile,
  parseListRows,
  redactUrl,
  showingRange,
  type ListKind,
  type ParsedListRow,
} from '../services/delhivery-billing-probe-files';

export const DELHIVERY_ORIGIN = 'https://one.delhivery.com';
/**
 * Where their invoices live — seen on the first production run (12 Sep
 * 2026). Tried FIRST; the discovery below is the fallback for the day they
 * move it. Their left rail is icons with no text, so no link names it.
 */
export const INVOICE_LIST_PATH = '/finances/invoices/invoice_list';
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
const NEXT_PAGE_RX = /arrow-right|next\s*page|^next$/;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TEXT = 200_000;
const MAX_LINKS_PER_PAGE = 80;
const MAX_LIST_ROWS = 60;
/** Pages of one list read before stopping (each also takes a page from the budget). */
const MAX_LIST_PAGES = 5;
/** Per invoice: its PDF, its itemized file, and one more format if offered. */
const FILES_PER_INVOICE = 3;
const MAX_MENU_OPTIONS = 15;
/** A list is given this long to draw real rows after a navigation or a range change. */
export const ROWS_WAIT_POLLS = 20;
const ROWS_POLL_MS = 1_000;
/** A table with no rows and no skeleton for this many looks is empty, not loading. */
const EMPTY_STABLE_POLLS = 3;
/** No table at all after this many looks: this is not the list. */
const NO_TABLE_POLLS = 5;
const MENU_WAIT_MS = 800;
/** A shipment-level file for a month of parcels is generated on click; give it time. */
const OPTION_DOWNLOAD_TIMEOUT_MS = 30_000;

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

/** How a wait for a list's rows ended. Only `rows` means data was read. */
export type RowsState = 'rows' | 'empty' | 'timeout' | 'no-table';

export interface ListRange {
  readonly requested: 'Last 90 days';
  /** The 90-day list is what was read. */
  readonly applied: boolean;
  /** The date-range control's own text for the range that was read. */
  readonly label: string | null;
  /** "Last 90 days" was chosen but never drew real rows; the default range was read. */
  readonly fellBack: boolean;
  readonly ninetyDayState: RowsState | null;
}

export interface InvoiceListFinding {
  readonly pageUrl: string;
  readonly headers: readonly string[];
  readonly rowCount: number;
  /** DATA rows only — skeleton placeholders are never recorded as rows. */
  readonly rows: readonly (readonly string[])[];
  /** What each of the first rows offers to click, by label. */
  readonly rowControls: readonly {
    readonly row: number;
    readonly controls: readonly { readonly label: string; readonly href: string | null }[];
  }[];
  /** True when their "Last 90 days" preset was read; null when there was no picker. */
  readonly rangeApplied: boolean | null;
  readonly range: ListRange;
  readonly loaded: RowsState;
  readonly pagesRead: number;
  readonly parsedRows: readonly ParsedListRow[];
  /** The latest invoice of each service type — the ones whose files are fetched. */
  readonly picks: readonly {
    readonly rowIndex: number;
    readonly reason: string;
    readonly cells: readonly string[];
  }[];
}

export interface NoteListFinding {
  readonly kind: 'creditNotes' | 'debitNotes';
  readonly tab: string;
  readonly pageUrl: string;
  readonly loaded: RowsState;
  readonly rangeLabel: string | null;
  readonly headers: readonly string[];
  readonly rowCount: number;
  readonly rows: readonly (readonly string[])[];
  readonly parsedRows: readonly ParsedListRow[];
  /** The key of the note whose files were fetched, or null. */
  readonly latest: string | null;
}

export interface DownloadMenuFinding {
  readonly list: ListKind;
  readonly invoiceId: string;
  /** The row control that was clicked, by its own label. */
  readonly trigger: string | null;
  /** Every option the menu showed, by its text — clicked or not. */
  readonly options: readonly string[];
  readonly note: string | null;
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
  /** The invoice / note it belongs to, when it came from a row's download menu. */
  readonly forInvoice: string | null;
  readonly list: ListKind | null;
  /** The menu option that produced it, by its text. */
  readonly option: string | null;
}

export interface Attempt {
  readonly forRow: number | null;
  readonly control: string;
  readonly outcome: string;
}

export interface RawExploration {
  readonly pages: readonly RawPage[];
  readonly invoiceList: InvoiceListFinding | null;
  readonly downloadMenus: readonly DownloadMenuFinding[];
  readonly creditNotes: NoteListFinding | null;
  readonly debitNotes: NoteListFinding | null;
  readonly downloads: readonly RawDownload[];
  readonly attempts: readonly Attempt[];
  readonly refused: readonly { readonly label: string; readonly reason: string }[];
  readonly notFound: readonly string[];
  readonly stoppedBy: BudgetKind | null;
  readonly error: string | null;
}

export interface Control {
  readonly id: string;
  /** What the guard judges: text, aria-label, title, icon names. */
  readonly label: string;
  /** The visible text alone, for elements found by what they say. */
  readonly text?: string;
  readonly href: string | null;
  readonly tag: string;
}

export interface RawTable {
  readonly headers: string[];
  readonly rowCount: number;
  readonly rows: { cells: string[]; controls: Control[] }[];
}

export interface RawSnapshot {
  readonly title: string;
  readonly headings: string[];
  readonly links: { text: string; href: string }[];
  readonly menu: string[];
  readonly buttons: string[];
}

interface Snapshot {
  readonly finding: PageFinding;
  readonly rawLinks: readonly { text: string; href: string }[];
  readonly tables: readonly RawTable[];
}

interface RowsWait {
  readonly state: RowsState;
  readonly table: RawTable | null;
}

interface ListRead {
  readonly finding: InvoiceListFinding;
  readonly url: string;
}

/**
 * Everything the probe asks of the page's DOM. Each is a READ, or tags an
 * element with a `data-sd-probe` / `data-sd-seen` attribute so a later
 * click can find it — nothing here clicks. A seam so a test can hand in a
 * fake page without running the browser-side source.
 */
export interface BillingDom {
  snapshot(): Promise<RawSnapshot>;
  tables(): Promise<RawTable[]>;
  bodyText(): Promise<string>;
  tagOne(selector: string, rx: RegExp): Promise<Control | null>;
  tagAll(selector: string, rx: RegExp, cap: number): Promise<Control[]>;
  candidate(id: string): Promise<ClickCandidate | null>;
  /** The row whose cell reads `key` exactly: its "Download" control. */
  rowTrigger(key: string): Promise<Control | null>;
  /** Mark everything visible now, so `newlyVisible` can say what a click made appear. */
  markSeen(): Promise<void>;
  newlyVisible(cap: number): Promise<Control[]>;
  /** A visible element whose text is exactly `text` (a menu option, found again). */
  byText(text: string): Promise<Control | null>;
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
  var ctl = function (el, text) {
    return { id: tagEl(el), label: labelOf(el), text: text, href: el.getAttribute('href'), tag: el.tagName.toLowerCase() };
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

/**
 * The row carrying a cell that reads `key` exactly, and inside it the
 * control whose label says "download" — clickable first, then the most
 * specific (shortest label). Their row control is a "Download ⌄" menu,
 * not a button, so every element is a candidate.
 */
function rowTriggerJs(key: string): string {
  return `(function () { ${LIB}
    var key = ${JSON.stringify(key)};
    var rows = Array.prototype.slice.call(document.querySelectorAll('tr, [role="row"]')).filter(vis);
    for (var i = 0; i < rows.length; i++) {
      var cells = rows[i].querySelectorAll('td, [role="cell"], [role="gridcell"]');
      var hit = false;
      for (var c = 0; c < cells.length; c++) { if (clip(cells[c].innerText, 200) === key) { hit = true; break; } }
      if (!hit) continue;
      var best = null; var bestLabel = ''; var bestPtr = false;
      var els = rows[i].querySelectorAll('*');
      for (var e = 0; e < els.length; e++) {
        var el = els[e];
        if (!vis(el)) continue;
        var l = labelOf(el);
        if (!/download/i.test(l)) continue;
        var ptr = getComputedStyle(el).cursor === 'pointer' || /^(a|button)$/i.test(el.tagName) ||
          el.getAttribute('role') === 'button';
        if (best === null || (ptr && !bestPtr) || (ptr === bestPtr && l.length < bestLabel.length)) {
          best = el; bestLabel = l; bestPtr = ptr;
        }
      }
      return best === null ? null : ctl(best, clip(best.innerText, 80));
    }
    return null;
  })()`;
}

/** Clear old marks, then mark everything visible now. */
const MARK_SEEN_JS = `(function () {
  var old = document.querySelectorAll('[data-sd-seen]');
  for (var i = 0; i < old.length; i++) old[i].removeAttribute('data-sd-seen');
  var els = document.querySelectorAll('body *');
  for (var j = 0; j < els.length; j++) {
    var r = els[j].getBoundingClientRect();
    if (r.width > 0 && r.height > 0) els[j].setAttribute('data-sd-seen', '1');
  }
  return els.length;
})()`;

/** Visible, unmarked elements carrying short text — the deepest one per text. */
function newlyVisibleJs(cap: number): string {
  return `(function () { ${LIB}
    var fresh = function (el) { return !el.hasAttribute('data-sd-seen') && vis(el); };
    var els = Array.prototype.slice.call(document.querySelectorAll('body *')).filter(fresh);
    var out = []; var seenText = [];
    for (var i = 0; i < els.length && out.length < ${cap}; i++) {
      var el = els[i];
      var raw = String(el.innerText || '').trim();
      if (raw === '' || raw.length > 80) continue;
      var t = clip(raw, 80);
      var kids = el.querySelectorAll('*'); var deeper = false;
      for (var k = 0; k < kids.length; k++) { if (fresh(kids[k]) && clip(kids[k].innerText, 80) === t) { deeper = true; break; } }
      if (deeper || seenText.indexOf(t) >= 0) continue;
      seenText.push(t);
      out.push(ctl(el, t));
    }
    return out;
  })()`;
}

/** A visible element whose text is exactly `text`, preferring one inside a menu. */
function byTextJs(text: string): string {
  return `(function () { ${LIB}
    var want = ${JSON.stringify(text)};
    var els = Array.prototype.slice.call(document.querySelectorAll('body *')).filter(vis);
    var menuish = null; var any = null;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (clip(el.innerText, 80) !== want) continue;
      if (el.closest('thead, nav, header, aside, [role="tablist"]')) continue;
      var kids = el.querySelectorAll('*'); var deeper = false;
      for (var k = 0; k < kids.length; k++) { if (vis(kids[k]) && clip(kids[k].innerText, 80) === want) { deeper = true; break; } }
      if (deeper) continue;
      var inMenu = !!el.closest('[role="menu"], [role="listbox"], [role="menuitem"], [role="option"], li, ' +
        '[class*="dropdown"], [class*="menu"], [class*="popover"], [class*="option"]');
      if (inMenu && menuish === null) menuish = el;
      if (any === null) any = el;
    }
    var best = menuish || any;
    return best === null ? null : ctl(best, want);
  })()`;
}

/** The DOM of a live Playwright page. */
export function pageDom(page: Page): BillingDom {
  const run = async <T>(src: string): Promise<T> => (await page.evaluate(src)) as T;
  return {
    snapshot: () => run<RawSnapshot>(SNAPSHOT_JS),
    tables: async () => (await run<RawTable[] | null>(TABLES_JS)) ?? [],
    bodyText: () =>
      page
        .locator('body')
        .innerText({ timeout: 15_000 })
        .catch(() => ''),
    tagOne: async (s, rx) => (await run<Control | null>(tagByTextJs(s, rx))) ?? null,
    tagAll: async (s, rx, cap) => (await run<Control[] | null>(tagAllJs(s, rx, cap))) ?? [],
    candidate: async (id) => (await run<ClickCandidate | null>(candidateJs(id))) ?? null,
    rowTrigger: async (key) => (await run<Control | null>(rowTriggerJs(key))) ?? null,
    markSeen: async () => {
      await run<number>(MARK_SEEN_JS);
    },
    newlyVisible: async (cap) => (await run<Control[] | null>(newlyVisibleJs(cap))) ?? [],
    byText: async (text) => (await run<Control | null>(byTextJs(text))) ?? null,
  };
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
const isFollowableHref = (href: string | null): href is string =>
  href !== null && href.trim() !== '' && !/^(#|javascript:)/i.test(href.trim());

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

function invoiceTable(tables: readonly RawTable[]): RawTable | null {
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

/** A notes tab's table: one naming notes if there is one, else the first with headers. */
function noteTable(tables: readonly RawTable[]): RawTable | null {
  const scored = tables
    .map((t) => {
      const h = t.headers.join(' | ');
      let score = /note|credit|debit/i.test(h) ? 3 : 0;
      if (/amount|total/i.test(h)) score += 1;
      if (/date/i.test(h)) score += 1;
      return { t, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored.find((s) => s.score > 0)?.t ?? tables.find((t) => t.headers.length > 0) ?? null;
}

/**
 * Delhivery ONE's billing area.
 *
 * ── WHAT THE FIRST RUN SHOWED (12 Sep 2026) ─────────────────────────
 * The invoices are at `/finances/invoices/invoice_list`, under tabs
 * "Invoice List" / "Credit Notes" / "Debit Notes", with a "Date Range"
 * control (default: the last ~30 days) and one row per invoice: INVOICE ID
 * | INVOICE DATE | GST NUMBER | SERVICE TYPE | INVOICE AMOUNT | and a
 * "Download ⌄" MENU. That url is tried first; the discovery that found it
 * (start on the Finances page, follow links naming billing, try an
 * Invoices tab, then guessed urls) stays as the fallback.
 *
 * ── A LIST IS NOT READ UNTIL IT HAS DRAWN ────────────────────────────
 * After every navigation and range change the list draws twenty grey
 * placeholder rows first. The first run read those as data and downloaded
 * nothing. `waitForRows` looks again until a row carries an id, for a
 * bounded time, and says how the wait ended; if "Last 90 days" never draws,
 * the default range that DID is read, and the finding says so.
 *
 * ── READ-ONLY ────────────────────────────────────────────────────────
 * It navigates (GET), reads, and downloads. Every click is judged by
 * `judgeClick` against the element's own label; every url by
 * `judgeNavigation`. A menu option that reads as an action is recorded as
 * refused and never clicked. It never types into anything and never
 * submits a form. The only key it presses is Escape, to close a menu.
 */
export class DelhiveryBillingPage {
  private readonly pages: RawPage[] = [];
  private readonly downloads: RawDownload[] = [];
  private readonly attempts: Attempt[] = [];
  private readonly refused: { label: string; reason: string }[] = [];
  private readonly notFound: string[] = [];
  private readonly menus: DownloadMenuFinding[] = [];
  private readonly visited = new Set<string>();
  private readonly notes: {
    creditNotes: NoteListFinding | null;
    debitNotes: NoteListFinding | null;
  } = { creditNotes: null, debitNotes: null };
  /** Which row's files are being fetched, so a download can say whose it is. */
  private current: { invoiceId: string; list: ListKind; option: string | null } | null = null;

  constructor(
    private readonly page: Page,
    private readonly budget: ProbeBudget,
    private readonly dom: BillingDom = pageDom(page),
  ) {}

  async explore(): Promise<RawExploration> {
    let invoiceList: InvoiceListFinding | null = null;
    let stoppedBy: BudgetKind | null = null;
    let error: string | null = null;
    try {
      this.page.setDefaultTimeout(20_000);
      const list = await this.openInvoiceList();
      if (list === null) {
        this.notFound.push(
          'No table with an "invoice" column on any page visited. The menus, links and ' +
            'screenshots of every page are recorded — the invoices are elsewhere, or not a table.',
        );
      } else {
        invoiceList = list.finding;
        const picks = latestPerServiceType(list.finding.parsedRows);
        for (const p of picks) await this.downloadRow('invoices', p.key);
        const firstKey = list.finding.parsedRows[0]?.key ?? null;
        await this.readNotes('creditNotes', list.url, firstKey);
        await this.readNotes('debitNotes', list.url, firstKey);
      }
    } catch (err) {
      if (err instanceof ProbeBudgetExhausted) stoppedBy = err.kind;
      else error = (err instanceof Error ? err.message : String(err)).slice(0, 400);
    }
    return {
      pages: this.pages,
      invoiceList,
      downloadMenus: this.menus,
      creditNotes: this.notes.creditNotes,
      debitNotes: this.notes.debitNotes,
      downloads: this.downloads,
      attempts: this.attempts,
      refused: this.refused,
      notFound: this.notFound,
      stoppedBy,
      error,
    };
  }

  // ── Finding the list ──────────────────────────────────────────────────

  private async openInvoiceList(): Promise<ListRead | null> {
    const url = `${DELHIVERY_ORIGIN}${INVOICE_LIST_PATH}`;
    if ((await this.visit(url, 'the invoice list (known url)')) !== null) {
      const hit = await this.listHere(url, 'the invoice list once its rows drew');
      if (hit !== null) return hit;
    }
    return this.findInvoiceList();
  }

  private async findInvoiceList(): Promise<ListRead | null> {
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
  private async tryInvoiceTab(): Promise<ListRead | null> {
    const tab = await this.dom.tagOne(
      '[role="tab"], button, [role="button"], li, [role="menuitem"]',
      INVOICE_TAB_RX,
    );
    if (tab === null || tab.href !== null) return null; // a link is visited, not clicked
    this.budget.takePage();
    if (!(await this.guardedClick(tab.id))) return null;
    await this.settle();
    return this.listOn(await this.snapshot(`tab: "${tab.label}"`));
  }

  /** The list on this page, if the page carries an invoice table (loaded or not). */
  private async listOn(snap: Snapshot): Promise<ListRead | null> {
    if (invoiceTable(snap.tables) === null) return null;
    return this.listHere(this.page.url(), `${snap.finding.why} — once its rows drew`);
  }

  /**
   * Read the invoice list on the current page: wait for real rows, try the
   * 90-day range (falling back to the default if it never draws), then any
   * further pages. Null when there is no invoice table here at all.
   */
  private async listHere(listUrl: string, why: string): Promise<ListRead | null> {
    const first = await this.waitForRows(why, 'invoices');
    if (first.table === null) return null;
    const defaultLabel = await this.rangeLabel();

    let wait: RowsWait = first;
    let label = defaultLabel;
    let applied = false;
    let fellBack = false;
    let ninetyDayState: RowsState | null = null;
    const tried = await this.tryNinetyDays();
    if (tried === true) {
      this.budget.takePage();
      const w = await this.waitForRows(
        'the invoice list after choosing "Last 90 days"',
        'invoices',
      );
      ninetyDayState = w.state;
      if (
        w.table !== null &&
        (w.state === 'rows' || (w.state === 'empty' && first.state !== 'rows'))
      ) {
        wait = w;
        applied = true;
        label = await this.rangeLabel();
      } else {
        // Never drew: go back to the default range, which did.
        fellBack = true;
        const back = await this.revisit(
          listUrl,
          'back to the default range — "Last 90 days" never drew its rows',
        );
        const again =
          back === null ? null : await this.waitForRows('the default range, again', 'invoices');
        if (again !== null && again.state === 'rows') wait = again;
      }
    }

    const table = wait.table ?? first.table;
    const cells = table.rows.map((r) => r.cells);
    const real = classifyListRows(table.headers, cells).real;
    const rowControls = real.slice(0, 5).map((i, row) => ({
      row,
      controls: (table.rows[i]?.controls ?? []).map((c) => ({
        label: c.label,
        href: c.href === null ? null : redactUrl(this.absolute(c.href)),
      })),
    }));
    const parsed = parseListRows(table.headers, cells);
    const { rows: allRows, pagesRead } = await this.furtherPages(parsed, wait.state);
    const picks = latestPerServiceType(allRows);

    return {
      url: listUrl,
      finding: {
        pageUrl: redactUrl(listUrl),
        headers: table.headers,
        rowCount: allRows.length,
        rows: allRows.slice(0, MAX_LIST_ROWS).map((r) => r.cells),
        rowControls,
        rangeApplied: tried === null ? null : applied,
        range: { requested: 'Last 90 days', applied, label, fellBack, ninetyDayState },
        loaded: wait.state,
        pagesRead,
        parsedRows: allRows.slice(0, MAX_LIST_ROWS),
        picks: picks.map((p) => ({
          rowIndex: p.rowIndex,
          reason: p.reason,
          cells: allRows[p.rowIndex]?.cells ?? [],
        })),
      },
    };
  }

  /** "Showing 1 - 50 of 73": follow their pager until the list is read, up to the cap. */
  private async furtherPages(
    firstPage: ParsedListRow[],
    state: RowsState,
  ): Promise<{ rows: ParsedListRow[]; pagesRead: number }> {
    const rows = [...firstPage];
    let pagesRead = 1;
    if (state !== 'rows') return { rows, pagesRead };
    // The first key of the page on screen: until it changes, the pager has not moved.
    let pageFirst = firstPage[0]?.key ?? null;
    while (pagesRead < MAX_LIST_PAGES) {
      const shown = showingRange(await this.dom.bodyText());
      if (shown === null || shown.to >= shown.total) break;
      const next = await this.dom.tagOne('button, [role="button"], a, li, span, i', NEXT_PAGE_RX);
      if (next === null) break;
      this.budget.takePage();
      if (!(await this.guardedClick(next.id))) break;
      const w = await this.waitForRows(
        `the invoice list, page ${pagesRead + 1}`,
        'invoices',
        pageFirst,
      );
      if (w.state !== 'rows' || w.table === null) break;
      const onPage = parseListRows(
        w.table.headers,
        w.table.rows.map((r) => r.cells),
      );
      pageFirst = onPage[0]?.key ?? null;
      const known = new Set(rows.map((r) => r.key));
      const fresh = onPage.filter((r) => !known.has(r.key));
      if (fresh.length === 0) break;
      rows.push(...fresh);
      pagesRead += 1;
    }
    return { rows, pagesRead };
  }

  /**
   * Look at the list until it has DRAWN: at least one row with an id.
   * Skeleton rows (every cell empty) are "still loading", never data. A
   * table with neither rows nor skeletons for a few looks — or a lone
   * "no data" row — is empty. `notFirst`: the first key of what was on
   * screen before (a tab or page change), which means "not yet".
   */
  private async waitForRows(
    why: string,
    kind: ListKind,
    notFirst?: string | null,
  ): Promise<RowsWait> {
    let last: RawTable | null = null;
    let emptyStreak = 0;
    let state: RowsState = 'timeout';
    for (let poll = 1; poll <= ROWS_WAIT_POLLS; poll += 1) {
      this.budget.checkTime();
      const tables = await this.dom.tables();
      const t = kind === 'invoices' ? invoiceTable(tables) : noteTable(tables);
      if (t === null) {
        if (last === null && poll >= NO_TABLE_POLLS) {
          state = 'no-table';
          break;
        }
      } else {
        last = t;
        const cells = t.rows.map((r) => r.cells);
        const c = classifyListRows(t.headers, cells);
        const firstKey = parseListRows(t.headers, cells)[0]?.key ?? null;
        const stale = notFirst !== undefined && notFirst !== null && firstKey === notFirst;
        if (c.real.length > 0 && !stale) {
          state = 'rows';
          break;
        }
        if (c.emptyMessage && !stale) {
          state = 'empty';
          break;
        }
        emptyStreak = c.real.length === 0 && c.skeleton === 0 ? emptyStreak + 1 : 0;
        if (emptyStreak >= EMPTY_STABLE_POLLS) {
          state = 'empty';
          break;
        }
      }
      await this.page.waitForTimeout(ROWS_POLL_MS);
    }
    await this.snapshot(`${why} (${state})`);
    return { state, table: last };
  }

  /**
   * Their date picker's "Last 90 days" preset, as the wallet page uses it.
   * Null when there is no picker; false when there is one we could not set.
   */
  private async tryNinetyDays(): Promise<boolean | null> {
    const trigger = await this.dom.tagOne(
      'button, [role="button"], div, span',
      /date\s*range|select\s*date|last\s+\d+\s+days|this\s+month/,
    );
    if (trigger === null) return null;
    if (!(await this.guardedClick(trigger.id))) return false;
    await this.page.waitForTimeout(800);
    const preset = await this.dom.tagOne(
      'li, button, [role="option"], [role="menuitem"], div, span',
      /^last\s*(90\s*days|3\s*months)$/,
    );
    if (preset === null || !(await this.guardedClick(preset.id))) {
      await this.page.keyboard.press('Escape').catch(() => undefined);
      return false;
    }
    await this.page.waitForTimeout(500);
    const done = await this.dom.tagOne('button, [role="button"]', /^(done|ok)$/);
    if (done !== null) await this.guardedClick(done.id);
    await this.settle();
    return true;
  }

  private async rangeLabel(): Promise<string | null> {
    return (
      (await this.dom.tagOne('button, [role="button"], div, span', /date\s*range/))?.label ?? null
    );
  }

  // ── Credit and debit notes ────────────────────────────────────────────

  private async readNotes(
    kind: 'creditNotes' | 'debitNotes',
    listUrl: string,
    invoiceFirstKey: string | null,
  ): Promise<void> {
    const name = kind === 'creditNotes' ? 'Credit Notes' : 'Debit Notes';
    if (pathOf(this.page.url()) !== pathOf(listUrl)) {
      if ((await this.revisit(listUrl, `back to the invoice list for its "${name}" tab`)) === null)
        return;
    }
    const rx = kind === 'creditNotes' ? /^credit\s*notes?$/ : /^debit\s*notes?$/;
    const tab = await this.dom.tagOne(
      '[role="tab"], button, [role="button"], li, a, span, div',
      rx,
    );
    if (tab === null) {
      this.notFound.push(`No "${name}" tab on the invoice list.`);
      return;
    }
    // A tab is navigation: a link is followed, anything else is clicked through the guard.
    if (isFollowableHref(tab.href)) {
      if ((await this.revisit(this.absolute(tab.href), `the "${tab.label}" tab (a link)`)) === null)
        return;
    } else {
      this.budget.takePage();
      if (!(await this.guardedClick(tab.id))) return;
      await this.settle();
    }
    const w = await this.waitForRows(`the "${tab.label}" tab`, kind, invoiceFirstKey);
    const table = w.table;
    const cells = table === null ? [] : table.rows.map((r) => r.cells);
    const parsed = table === null || w.state !== 'rows' ? [] : parseListRows(table.headers, cells);
    const latest = latestRow(parsed);
    this.notes[kind] = {
      kind,
      tab: tab.label,
      pageUrl: redactUrl(this.page.url()),
      loaded: w.state,
      rangeLabel: await this.rangeLabel(),
      headers: table?.headers ?? [],
      rowCount: parsed.length,
      rows: parsed.slice(0, MAX_LIST_ROWS).map((r) => r.cells),
      parsedRows: parsed.slice(0, MAX_LIST_ROWS),
      latest: latest?.key ?? null,
    };
    if (latest !== null) await this.downloadRow(kind, latest.key);
  }

  // ── Downloading ───────────────────────────────────────────────────────

  private downloadsLeft(): number {
    return this.budget.limits.maxDownloads - this.budget.used().downloads;
  }

  /**
   * One row's files. Its "Download ⌄" control opens a MENU: open it, record
   * every option, close it, then fetch each option that names a file — each
   * option click through the guard, and one that reads as an action is
   * recorded as refused and never clicked.
   */
  private async downloadRow(list: ListKind, key: string): Promise<void> {
    this.current = { invoiceId: key, list, option: null };
    try {
      if (this.downloadsLeft() <= 0) {
        this.attempts.push({
          forRow: null,
          control: '(download cap)',
          outcome: `the download cap was reached — ${key} was not downloaded`,
        });
        return;
      }
      const trigger = await this.dom.rowTrigger(key);
      if (trigger === null) {
        this.menus.push({
          list,
          invoiceId: key,
          trigger: null,
          options: [],
          note: 'no control reading "Download" on the row (is the row on the page shown?)',
        });
        return;
      }
      if (isFollowableHref(trigger.href)) {
        this.menus.push({
          list,
          invoiceId: key,
          trigger: trigger.label,
          options: [],
          note: "the row's Download is a link, followed directly",
        });
        await this.tryControl(trigger, null, 0);
        return;
      }

      await this.dom.markSeen();
      const direct = this.page
        .waitForEvent('download', { timeout: MENU_WAIT_MS + 2_000 })
        .catch(() => null);
      if (!(await this.guardedClick(trigger.id))) {
        this.menus.push({
          list,
          invoiceId: key,
          trigger: trigger.label,
          options: [],
          note: 'the Download control was refused',
        });
        return;
      }
      await this.page.waitForTimeout(MENU_WAIT_MS);
      const found = await this.dom.newlyVisible(MAX_MENU_OPTIONS);
      const texts = [...new Set(found.map((o) => o.text ?? o.label))];
      if (found.length === 0) {
        const d = await direct;
        if (d !== null) {
          this.budget.takeDownload();
          await this.keepDownload(d, null, trigger.label, 'download');
        }
        this.menus.push({
          list,
          invoiceId: key,
          trigger: trigger.label,
          options: [],
          note:
            d === null
              ? 'clicked; no menu appeared and nothing downloaded'
              : 'the control downloaded a file itself — no menu',
        });
        return;
      }
      this.menus.push({ list, invoiceId: key, trigger: trigger.label, options: texts, note: null });
      await this.closeMenu(key, texts[0] ?? null);

      let got = 0;
      const tried = new Set<string>();
      for (const o of found) {
        const text = o.text ?? o.label;
        if (tried.has(text)) continue;
        tried.add(text);
        const verdict = judgeClick({ label: o.label, tag: o.tag, type: '', inForm: false });
        if (!verdict.allowed) {
          this.refused.push({ label: o.label, reason: verdict.reason });
          continue;
        }
        if (!namesAFile(text)) continue;
        if (got >= FILES_PER_INVOICE || this.downloadsLeft() <= 0) {
          this.attempts.push({
            forRow: null,
            control: text,
            outcome:
              got >= FILES_PER_INVOICE
                ? `not fetched — ${FILES_PER_INVOICE} files per invoice`
                : 'not fetched — the download cap was reached',
          });
          continue;
        }
        got += await this.clickMenuOption(key, text);
      }
    } finally {
      this.current = null;
    }
  }

  /** Escape, and if the menu is still up, toggle it shut with its own trigger. */
  private async closeMenu(key: string, probeText: string | null): Promise<void> {
    await this.page.keyboard.press('Escape').catch(() => undefined);
    await this.page.waitForTimeout(300);
    if (probeText === null || (await this.dom.byText(probeText)) === null) return;
    const trigger = await this.dom.rowTrigger(key);
    if (trigger !== null) await this.guardedClick(trigger.id);
    await this.page.waitForTimeout(300);
  }

  /** Re-open the row's menu if it is shut, and click one option for its file. */
  private async clickMenuOption(key: string, text: string): Promise<number> {
    let opt = await this.dom.byText(text);
    if (opt === null) {
      const trigger = await this.dom.rowTrigger(key);
      if (trigger === null || !(await this.guardedClick(trigger.id))) {
        this.attempts.push({
          forRow: null,
          control: text,
          outcome: "could not re-open the row's Download menu",
        });
        return 0;
      }
      await this.page.waitForTimeout(MENU_WAIT_MS);
      opt = await this.dom.byText(text);
    }
    if (opt === null) {
      this.attempts.push({
        forRow: null,
        control: text,
        outcome: 'the option did not reappear when the menu was re-opened',
      });
      return 0;
    }
    if (this.current !== null) this.current = { ...this.current, option: text };
    await this.dom.markSeen();
    return this.clickForFile(opt, null, 1, OPTION_DOWNLOAD_TIMEOUT_MS);
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
    const controls = await this.dom.tagAll('a, button, [role="button"]', DOWNLOAD_RX, 8);
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

  private async clickForFile(
    c: Control,
    forRow: number | null,
    depth: number,
    timeout = 15_000,
  ): Promise<number> {
    this.budget.takeDownload();
    const before = pathOf(this.page.url());
    const ctx = this.page.context();
    const waitDownload = this.page
      .waitForEvent('download', { timeout })
      .then((d): { kind: 'download'; d: Download } => ({ kind: 'download', d }))
      .catch(() => null);
    const waitPopup = ctx
      .waitForEvent('page', { timeout })
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
      // Whatever the click made appear (a toast: "report will be emailed").
      const shown = (await this.dom.newlyVisible(5)).map((o) => o.text ?? o.label);
      this.attempts.push({
        forRow,
        control: c.label,
        outcome: `clicked; nothing downloaded or opened${
          shown.length === 0 ? '' : ` — it showed: ${shown.map((s) => `"${s}"`).join(', ')}`
        }`,
      });
      await this.page.keyboard.press('Escape').catch(() => undefined);
      return 0;
    }
    const options = await this.dom.tagAll(
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

  /** Whose file this is — set while a row's files are being fetched. */
  private owner(): Pick<RawDownload, 'forInvoice' | 'list' | 'option'> {
    return {
      forInvoice: this.current?.invoiceId ?? null,
      list: this.current?.list ?? null,
      option: this.current?.option ?? null,
    };
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
      ...this.owner(),
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
      ...this.owner(),
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

  /** A url visited before, visited again on purpose. */
  private async revisit(url: string, why: string): Promise<Snapshot | null> {
    this.visited.delete(pathOf(url));
    return this.visit(url, why);
  }

  private async settle(): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await this.page.waitForTimeout(1_500);
  }

  private async snapshot(why: string): Promise<Snapshot> {
    this.budget.checkTime();
    const url = this.page.url();
    const raw = await this.dom.snapshot();
    const tables = await this.dom.tables();
    const text = await this.dom.bodyText();
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
    const info = await this.dom.candidate(id);
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

  private absolute(href: string, base = this.page.url()): string {
    try {
      return new URL(href, base).toString();
    } catch {
      return href;
    }
  }
}
