import { createHash } from 'node:crypto';
import type { Page } from 'playwright';
import { gotoPortal } from './navigate';
import { judgeClick } from '../services/portal-read-only-guard';

/** One bubble exactly as their window shows it. */
export interface WhatsappBubble {
  readonly text: string;
  /** The raw time text, with the date heading above it when there is one. */
  readonly sentLabel: string;
}

/**
 * The panel sent us to its sign-in page. Never answered with a login
 * from here: the batch stops and the pause is recorded.
 */
export class WhatsappLoggedOutError extends Error {
  constructor() {
    super('Delhivery One asked for a sign-in');
    this.name = 'WhatsappLoggedOutError';
  }
}

/** A CAPTCHA / challenge page: back off, never solve or retry it. */
export class WhatsappBlockedError extends Error {
  constructor() {
    super('Delhivery One showed a challenge page');
    this.name = 'WhatsappBlockedError';
  }
}

export interface WhatsappRead {
  /** The parcel's own screen was reached. False = we could not even open it. */
  readonly found: boolean;
  /** The "View Whatsapp" button exists on that screen. */
  readonly available: boolean;
  /**
   * Null when the window could not be read — NOT the same as empty. A
   * selector that stops matching must read as "could not read", never
   * as "the customer got no messages".
   */
  readonly messages: readonly WhatsappBubble[] | null;
}

const SHIPMENT_URL = (awb: string): string =>
  `https://one.delhivery.com/v2/shipments/forward/${encodeURIComponent(awb)}`;

/** A date on its own line ("14 Nov 2026", "Nov 14, 2026", "14/11/2026", "Today"). */
const DATE_PART =
  '(?:\\d{1,2}\\s+[A-Za-z]{3,9}(?:,?\\s+\\d{4})?|[A-Za-z]{3,9}\\s+\\d{1,2}(?:,?\\s+\\d{4})?|\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|today|yesterday)';
const TIME_PART = '\\d{1,2}[:.]\\d{2}(?::\\d{2})?\\s*(?:am|pm)?';
const DATE_LINE = new RegExp(`^${DATE_PART}$`, 'i');
const TIME_LINE = new RegExp(`^(?:${DATE_PART}\\s*[,·\\-|]?\\s+)?${TIME_PART}$`, 'i');
/** Window chrome that is not a message. */
const CHROME = /^(whatsapp|okay|ok|close|x|×|✕)$/i;

/**
 * The modal's visible text → bubbles, or null on ANY doubt.
 *
 * Layout assumed from the owner's screenshots: a bubble's text, then its
 * time label under it. Anything that does not fit that shape (a time with
 * no text before it, text left over with no time, nothing at all) is
 * "could not read", never a guess — so a redesign fails loudly in the
 * stored outcome instead of storing half a conversation.
 */
export function parseWhatsappModalText(raw: string): WhatsappBubble[] | null {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '' && !CHROME.test(l));
  const out: WhatsappBubble[] = [];
  let buffer: string[] = [];
  let dateCtx: string | null = null;
  for (const line of lines) {
    if (TIME_LINE.test(line)) {
      if (buffer.length === 0) return null;
      const hasDate = new RegExp(`^${DATE_PART}`, 'i').test(line);
      out.push({
        text: buffer.join('\n'),
        sentLabel: dateCtx !== null && !hasDate ? `${dateCtx}, ${line}` : line,
      });
      buffer = [];
      continue;
    }
    if (DATE_LINE.test(line)) {
      if (buffer.length > 0) return null;
      dateCtx = line;
      continue;
    }
    buffer.push(line);
  }
  if (buffer.length > 0 || out.length === 0) return null;
  return out;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A moment, only when the label carries a full date WITH a year and a
 * time. "12:45 PM" alone, or "14 Nov, 12:45 PM", is NULL: guessing the
 * day or year would put a message on the wrong date. IST, as their panel.
 */
export function parseSentAt(label: string): Date | null {
  const t = /(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(am|pm)?/i.exec(label);
  if (t === null) return null;
  let hour = Number(t[1]);
  const minute = Number(t[2]);
  const mer = t[3]?.toLowerCase();
  if (mer !== undefined) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (mer === 'pm' ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;

  let y: number | null = null;
  let m: number | null = null;
  let d: number | null = null;
  const dmy = /(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})/.exec(label);
  const mdy = /([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/.exec(label);
  const num = /(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(label);
  if (dmy !== null) {
    d = Number(dmy[1]);
    m = MONTHS.indexOf((dmy[2] ?? '').slice(0, 3).toLowerCase());
    y = Number(dmy[3]);
  } else if (mdy !== null) {
    m = MONTHS.indexOf((mdy[1] ?? '').slice(0, 3).toLowerCase());
    d = Number(mdy[2]);
    y = Number(mdy[3]);
  } else if (num !== null) {
    // Indian panel: day first.
    d = Number(num[1]);
    m = Number(num[2]) - 1;
    y = Number(num[3]);
  }
  if (y === null || m === null || d === null || m < 0 || m > 11 || d < 1 || d > 31) return null;
  const at = new Date(Date.UTC(y, m, d, hour, minute) - (5 * 60 + 30) * 60_000);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Stable per-parcel identity of a bubble. The n-th identical
 * (text, label) pair hashes differently so two real, identical bubbles
 * are both kept, while a re-read of the same window adds nothing.
 */
export function bubbleHashes(bubbles: readonly WhatsappBubble[]): string[] {
  const seen = new Map<string, number>();
  return bubbles.map((b) => {
    const key = `${b.text}\u0000${b.sentLabel}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return createHash('sha256').update(`${key}\u0000${n}`).digest('hex');
  });
}

/**
 * Read the WhatsApp window of one Delhivery One shipment page.
 *
 * READ-ONLY. The only clicks are "View Whatsapp" and the modal's
 * "Okay" (plus, in the fallback, the search-result row — the same click
 * ConsigneeCheckPage makes). Every click is judged by the read-only
 * guard on the element's own label first.
 *
 * Selectors (from the owner's screenshots of 2026-11-15, unverified live):
 *   - button  : role=button / link, name /view whatsapp/i
 *   - modal   : role=dialog (fallback: the ancestor of the "Whatsapp" title)
 *   - close   : role=button, name /^okay$/i inside the modal (Escape fallback)
 */
export class DelhiveryWhatsappPage {
  constructor(private readonly page: Page) {}

  async read(awbNumber: string): Promise<WhatsappRead> {
    const notFound: WhatsappRead = { found: false, available: false, messages: null };

    await gotoPortal(this.page, SHIPMENT_URL(awbNumber));
    // Their redirect to sign-in is client-side and takes a moment.
    await this.page.waitForTimeout(1_500).catch(() => undefined);
    this.assertSignedIn();
    let onParcel = await this.awbVisible(awbNumber, 15_000);
    this.assertSignedIn();

    if (!onParcel) {
      // Fallback: their list search, then open the row.
      await gotoPortal(this.page, 'https://one.delhivery.com/orders/forward');
      this.assertSignedIn();
      const search = this.page.getByPlaceholder(/search multiple awbs/i).first();
      const hasSearch = await search
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!hasSearch) return notFound;
      await search.fill(awbNumber);
      await search.press('Enter');
      const row = this.page.getByText(awbNumber, { exact: false }).first();
      const listed = await row
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!listed) return notFound;
      await row.click().catch(() => undefined);
      onParcel = await this.awbVisible(awbNumber, 20_000);
      if (!onParcel) return notFound;
    }

    const button = this.page
      .getByRole('button', { name: /view whatsapp/i })
      .or(this.page.getByRole('link', { name: /view whatsapp/i }))
      .first();
    const hasButton = await button
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (!hasButton) return { found: true, available: false, messages: null };

    const label = ((await button.innerText().catch(() => '')) || 'View Whatsapp').trim();
    const verdict = judgeClick({ label, tag: 'button', type: '', inForm: false });
    if (!verdict.allowed) return { found: true, available: true, messages: null };

    await button.click();
    const dialog = this.page.getByRole('dialog').first();
    const hasDialog = await dialog
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!hasDialog) return { found: true, available: true, messages: null };

    try {
      const raw = await dialog.innerText().catch(() => null);
      // A window that is not the WhatsApp one (title missing) is not ours to read.
      const isWhatsapp = raw !== null && /whatsapp/i.test(raw);
      return {
        found: true,
        available: true,
        messages: isWhatsapp ? parseWhatsappModalText(raw) : null,
      };
    } finally {
      await this.close(dialog);
    }
  }

  private assertSignedIn(): void {
    const url = this.page.url();
    if (/captcha|challenge|blocked/i.test(url)) throw new WhatsappBlockedError();
    if (/login|signin|ucp-auth/i.test(url)) throw new WhatsappLoggedOutError();
  }

  private async awbVisible(awb: string, timeout: number): Promise<boolean> {
    return this.page
      .getByText(awb, { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
  }

  private async close(dialog: ReturnType<Page['getByRole']>): Promise<void> {
    const okay = dialog.getByRole('button', { name: /^okay$/i }).first();
    const clicked = await okay
      .click({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) await this.page.keyboard.press('Escape').catch(() => undefined);
  }
}
