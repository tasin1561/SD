import type { Page } from 'playwright';
import { judgeNavigation } from '../services/portal-read-only-guard';
import { gotoPortal } from './navigate';

/**
 * What Delhivery One's shipment page says about an NDR that the tracking
 * API does not carry. Every field is "null = could not read": a selector
 * or wording that stops matching must never turn into a false "no NDR".
 */
export interface NdrPanelRead {
  /** An NDR is waiting for action. null = the page was not recognisable. */
  readonly open: boolean | null;
  /** "1/3 delivery attempts failed" -> 1 */
  readonly attemptsFailed: number | null;
  /** "1/3 delivery attempts failed" -> 3 */
  readonly attemptsMax: number | null;
  /** "Deadline: 2 Days" -> 2; hours ("Deadline: 5 Hours") -> 0. */
  readonly deadlineDays: number | null;
  /** "NDR Remark is not verified" / "Not Verified" chip -> false. */
  readonly remarkVerified: boolean | null;
  /** The text the "View NDRs" drawer shows, when it could be read. */
  readonly reasonText: string | null;
}

const ATTEMPTS = /(\d+)\s*\/\s*(\d+)\s*delivery\s+attempts?\s+failed/i;
const DEADLINE = /deadline\s*:?\s*(\d+)\s*(day|days|d|hour|hours|hr|hrs|h)\b/i;
const BANNER = /action\s+needed\s+to\s+ensure\s+timely\s+delivery/i;
const NDR_COUNT = /\bNDR\s*\(\s*(\d+)\s*\)/i;
const NOT_VERIFIED = /\bndr\s+remark\s+(?:is\s+)?not\s+verified\b|\bnot\s+verified\b/i;
const VERIFIED = /\bndr\s+remark\s+(?:is\s+)?verified\b/i;
const REASON_CAP = 600;

/**
 * Pure: the page's visible text (and whether a "View NDRs" button exists)
 * to the NDR facts. Returns null when NOTHING NDR-shaped could be read, so
 * the caller stores nothing.
 */
export function parseNdrPanelText(raw: string, hasViewNdrs = false): NdrPanelRead | null {
  const text = raw.replace(/\s+/g, ' ');
  const att = ATTEMPTS.exec(text);
  const attemptsFailed = att === null ? null : Number(att[1]);
  const attemptsMax = att === null ? null : Number(att[2]);

  const dl = DEADLINE.exec(text);
  let deadlineDays: number | null = null;
  if (dl !== null) {
    const n = Number(dl[1]);
    deadlineDays = /^h/i.test(dl[2] ?? '') ? 0 : n;
  }

  const count = NDR_COUNT.exec(text);
  const hasBanner = BANNER.test(text);
  const countedOpen = count !== null && Number(count[1]) > 0;

  let remarkVerified: boolean | null = null;
  if (NOT_VERIFIED.test(text)) remarkVerified = false;
  else if (VERIFIED.test(text)) remarkVerified = true;

  let open: boolean | null = null;
  if (hasBanner || countedOpen || hasViewNdrs) open = true;
  // "No NDR" is only said when the header chip proves the page was read.
  else if (att !== null) open = false;

  if (
    open === null &&
    attemptsFailed === null &&
    deadlineDays === null &&
    remarkVerified === null
  ) {
    return null;
  }
  return { open, attemptsFailed, attemptsMax, deadlineDays, remarkVerified, reasonText: null };
}

const CHROME = /^(close|dismiss|view ndrs?|okay|[×✕x])$/i;

/** Pure: the drawer's text, tidied; null when empty or not an NDR drawer. */
export function parseNdrDrawerText(raw: string): string | null {
  if (/whatsapp/i.test(raw)) return null;
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '' && !CHROME.test(l));
  if (lines.length === 0) return null;
  const joined = lines.join(' · ');
  return joined.length > REASON_CAP ? `${joined.slice(0, REASON_CAP - 1)}…` : joined;
}

/**
 * Read the NDR facts off the shipment page that is ALREADY open. No
 * navigation and NO clicks: "View NDRs" turned out to be a link to the
 * NDR page (read separately by `readNeedActionRow`), not a window.
 *
 * Selectors (owner's screenshot of AWB 38061110627384, unverified live):
 *   - header chip : text "N/M delivery attempts failed", "Deadline: N Days"
 *   - banner      : text "Action needed to ensure timely delivery"
 *   - block       : text "NDR (N)", "NDR Remark is not verified" + "Not Verified"
 *   - "View NDRs" : role=button/link name /^view ndrs?$/i — presence only
 *
 * Never throws: any failure is `null`.
 */
export async function readNdrPanel(page: Page): Promise<NdrPanelRead | null> {
  try {
    await page
      .getByText(/delivery\s+attempts?\s+failed|action\s+needed\s+to\s+ensure/i)
      .first()
      .waitFor({ state: 'visible', timeout: 4_000 })
      .catch(() => undefined);
    const text = await page.locator('body').innerText({ timeout: 5_000 });

    const button = page
      .getByRole('button', { name: /^view\s+ndrs?$/i })
      .or(page.getByRole('link', { name: /^view\s+ndrs?$/i }))
      .first();
    const hasButton = await button
      .waitFor({ state: 'visible', timeout: 2_000 })
      .then(() => true)
      .catch(() => false);

    // "View NDRs" navigates to the NDR page rather than opening a window,
    // so nothing is clicked here: the caller reads that page by address
    // (readNeedActionRow) once it has finished with this one.
    return parseNdrPanelText(text, hasButton);
  } catch {
    return null;
  }
}

/** The NDR page "View NDRs" links to, filtered to one AWB. */
export const NEED_ACTION_URL = (awb: string): string =>
  `https://one.delhivery.com/v2/exceptions/ndr/need-action?filter_awb=${encodeURIComponent(awb)}`;

const PAYMENT = /^(cod|prepaid|pre-paid)$/i;
const ATTEMPT_LINE = /^(\d+)\s+attempts?$/i;
const UPDATED_LINE = /\|\s*\d{1,2}:\d{2}\s*(am|pm)?$/i;
const ROW_ACTIONS = /^(consignee details|reattempt|re-attempt|return|view|download|bulk actions)/i;

/**
 * Pure: the NDR page's visible text to one line, e.g.
 * "Consignee Unavailable · 1 attempt · Nov 16 | 11:38 AM · Proof: Call not connected".
 * Layout from the owner's screenshot (2026-11-16): after the AWB come the
 * product, price, payment mode, NDR TYPE, "N attempt(s)", last updated,
 * then "Proofs" and the proof labels, then the row's action buttons.
 * Null when the AWB's row or its NDR type cannot be found.
 */
export function parseNeedActionText(raw: string, awb: string): string | null {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '');
  const at = lines.findIndex((l) => l.includes(awb));
  if (at < 0) return null;
  const rest = lines.slice(at + 1);
  const pay = rest.findIndex((l) => PAYMENT.test(l));
  const att = rest.findIndex((l) => ATTEMPT_LINE.test(l));
  if (pay < 0 || att < 0 || att - pay !== 2) return null;
  const type = rest[pay + 1] ?? '';
  if (type === '' || ROW_ACTIONS.test(type)) return null;
  const parts = [type, rest[att] ?? ''];
  const upd = rest[att + 1];
  if (upd !== undefined && UPDATED_LINE.test(upd)) parts.push(upd);
  const pi = rest.findIndex((l, i) => i > att && /^proofs?$/i.test(l));
  if (pi >= 0) {
    const proofs: string[] = [];
    for (const l of rest.slice(pi + 1)) {
      if (ROW_ACTIONS.test(l) || l.includes(awb) || proofs.length >= 4) break;
      proofs.push(l);
    }
    if (proofs.length > 0) parts.push(`Proof: ${proofs.join(', ')}`);
  }
  const joined = parts.join(' · ');
  return joined.length > REASON_CAP ? `${joined.slice(0, REASON_CAP - 1)}…` : joined;
}

/**
 * Open the NDR page for one AWB BY ADDRESS and read its row. Read-only:
 * the address passes `judgeNavigation`, and nothing on the page is
 * clicked — it carries "Reattempt" and "Return". Never throws.
 */
export async function readNeedActionRow(page: Page, awb: string): Promise<string | null> {
  try {
    const url = NEED_ACTION_URL(awb);
    if (!judgeNavigation(url).allowed) return null;
    await gotoPortal(page, url);
    const ok = await page
      .getByText(awb, { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) return null;
    const text = await page.locator('body').innerText({ timeout: 5_000 });
    return parseNeedActionText(text, awb);
  } catch {
    return null;
  }
}
