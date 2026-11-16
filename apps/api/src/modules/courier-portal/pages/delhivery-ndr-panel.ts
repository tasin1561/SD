import type { Page } from 'playwright';
import { judgeClickNdr } from '../services/portal-read-only-guard';

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
 * navigation. The only clicks are "View NDRs" and its close control,
 * each judged by `judgeClickNdr` (the allow-list) on the element's own
 * label. NEVER "Resolve now", "Activate now" or an edit pencil.
 *
 * Selectors (owner's screenshot of AWB 38061110627384, unverified live):
 *   - header chip : text "N/M delivery attempts failed", "Deadline: N Days"
 *   - banner      : text "Action needed to ensure timely delivery"
 *   - block       : text "NDR (N)", "NDR Remark is not verified" + "Not Verified"
 *   - drawer      : role=button/link name /^view ndrs?$/i, then role=dialog
 *   - close       : role=button name /^(close|dismiss|×|✕)$/i, Escape fallback
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

    const parsed = parseNdrPanelText(text, hasButton);
    if (parsed === null) return null;
    if (parsed.open !== true || !hasButton) return parsed;
    const reasonText = await readDrawer(page, button).catch(() => null);
    return { ...parsed, reasonText };
  } catch {
    return null;
  }
}

async function readDrawer(
  page: Page,
  button: ReturnType<Page['getByRole']>,
): Promise<string | null> {
  const label = ((await button.innerText().catch(() => '')) || 'View NDRs').trim();
  if (!judgeClickNdr({ label, tag: 'button', type: '', inForm: false }).allowed) return null;
  await button.click({ timeout: 5_000 });
  const dialog = page.getByRole('dialog').first();
  const shown = await dialog
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!shown) {
    await page.keyboard.press('Escape').catch(() => undefined);
    return null;
  }
  try {
    const raw = await dialog.innerText().catch(() => null);
    return raw === null ? null : parseNdrDrawerText(raw);
  } finally {
    const close = dialog.getByRole('button', { name: /^(close|dismiss|×|✕)$/i }).first();
    const closeLabel = ((await close.innerText().catch(() => '')) || 'Close').trim();
    const ok =
      judgeClickNdr({ label: closeLabel, tag: 'button', type: '', inForm: false }).allowed &&
      (await close
        .click({ timeout: 3_000 })
        .then(() => true)
        .catch(() => false));
    if (!ok) await page.keyboard.press('Escape').catch(() => undefined);
    await dialog.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => undefined);
  }
}
