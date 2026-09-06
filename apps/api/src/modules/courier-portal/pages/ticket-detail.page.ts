import type { Page } from 'playwright';
import { createHash } from 'node:crypto';

/** What a read of the thread gives us. */
export interface PortalThreadMessage {
  readonly body: string;
  readonly normalised: string;
  /**
   * OURS, not the courier's.
   *
   * Their thread right-aligns the client's own messages with
   * `justify-end`, exactly as a chat does. Without this every read would
   * hand our own words back as things Delhivery said — the seller would
   * see their own message quoted to them as a reply, and the classifier
   * would label our text with a courier state.
   */
  readonly mine: boolean;
}

export type PostCommentOutcome =
  /** Already in the thread. NOT an error — this is what makes retry safe. */
  | { readonly kind: 'ALREADY_PRESENT' }
  /** Written AND read back. The only success. */
  | { readonly kind: 'CONFIRMED' }
  /** Written, but the read-back could not find it. Caller must not retry. */
  | { readonly kind: 'SENT_UNVERIFIED'; readonly reason: string }
  /** SHADOW: everything up to the click happened. */
  | { readonly kind: 'SHADOW'; readonly wouldPost: string };

/** Whitespace-normalised, lowercased — the same shape the classifier uses. */
export function normalise(body: string): string {
  return body.replace(/\s+/g, ' ').trim().toLowerCase();
}

function hash(body: string): string {
  return createHash('sha256').update(normalise(body)).digest('hex');
}

/**
 * One ticket's thread.
 *
 * ── READ BEFORE WRITE, READ BACK AFTER ───────────────────────────────
 * This is the single property that makes a timeout survivable. A comment
 * post is not idempotent: if the click succeeds and the response is lost,
 * a retry duplicates a message in a thread the customer reads, and we
 * cannot see that it happened.
 *
 * So: read the thread first and return ALREADY_PRESENT if the text is
 * there — which turns "did my last attempt land?" from a guess into a
 * lookup. Then post. Then read again, and only return CONFIRMED if the
 * text is now present. A write we cannot verify returns SENT_UNVERIFIED
 * and the caller leaves it for the reconciler; it never asserts success
 * and never retries on its own.
 *
 * ── SELECTORS VERIFIED AGAINST THE REAL PORTAL (2026-09-06) ──────────
 * Every selector here was inferred from ordinary support-desk markup
 * until a read-only probe ran against one.delhivery.com with the live
 * session. Two of the guesses were wrong in the worst way — silently:
 *
 *   - The thread was read with `[data-testid="ticket-message"]` and
 *     friends, which matched NOTHING. `readThread` returned [], and an
 *     empty thread is indistinguishable from a selector miss — so
 *     read-before-write would have concluded "not present" and posted a
 *     duplicate into a thread the customer reads.
 *   - The composer was assumed to be a `<textarea>`. It is an
 *     `<input placeholder="Enter your message">`, so every reply would
 *     have thrown on `fill` instead of sending.
 *
 * What is actually there: `.scroll-window > .space-y-6 > div`, one div
 * per message, and the client's own carry `justify-end`. Confirmed by
 * reading a real ticket: one message ours, two theirs, correctly split.
 */
export class TicketDetailPage {
  constructor(
    private readonly page: Page,
    private readonly origin = 'https://one.delhivery.com',
  ) {}

  /**
   * Open a thread by its DETAIL url.
   *
   * Takes the url and not the `J…` id: their detail page lives at
   * `/support/<uuid>`, a different identifier entirely, and there is no
   * route that accepts the id a person reads. The list is what maps one
   * to the other.
   */
  async open(detailUrl: string): Promise<void> {
    const url = detailUrl.startsWith('http') ? detailUrl : `${this.origin}${detailUrl}`;
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.settle();
  }

  /** Wait for the conversation itself, not merely for the shell. */
  async settle(): Promise<void> {
    await this.page
      .locator('text=Support Conversations')
      .first()
      .waitFor({ timeout: 30_000 })
      .catch(() => undefined);
    await this.page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  }

  /**
   * Which of their three states this ticket is in, read from the detail.
   *
   * The word sits immediately after "Ticket ID" in the header. Null when
   * the page has not rendered it — never a guess, because "not Open"
   * would close a seller's ticket on a slow page.
   */
  async readState(): Promise<'OPEN' | 'RESOLVED' | 'CLOSED' | null> {
    const text = (await this.page.locator('body').innerText()).replace(/\s+/g, ' ');
    const m = /Ticket ID\s*(Open|Resolved|Closed)/i.exec(text);
    const word = m?.[1]?.toUpperCase();
    return word === 'OPEN' || word === 'RESOLVED' || word === 'CLOSED' ? word : null;
  }

  /**
   * Every message in the thread.
   *
   * Returns [] only when the page genuinely has none. A selector miss
   * ALSO returns [] and is indistinguishable, which is why `postComment`
   * treats an empty thread as a reason to be careful rather than as
   * licence to post — see `readBackOrUnverified`.
   */
  async readThread(): Promise<PortalThreadMessage[]> {
    // Their thread is `.scroll-window > .space-y-6 > div`, one div per
    // message, and the client's own carry `justify-end`. Read from the
    // real page rather than from a list of plausible class names — the
    // guessed ones matched nothing at all, and a selector that finds
    // nothing is indistinguishable from a thread with no messages.
    const rows = this.page.locator('.scroll-window .space-y-6 > div');
    const n = await rows.count();
    const out: PortalThreadMessage[] = [];
    for (let i = 0; i < n; i += 1) {
      const row = rows.nth(i);
      const text = (await row.innerText().catch(() => '')).trim();
      if (text === '') continue;
      const cls = (await row.getAttribute('class').catch(() => '')) ?? '';
      out.push({ body: text, normalised: normalise(text), mine: cls.includes('justify-end') });
    }
    return out;
  }

  private present(thread: readonly PortalThreadMessage[], body: string): boolean {
    const target = hash(body);
    // Substring as well as equality: the portal may wrap our text in a
    // signature or a quoted header, and a message that is PRESENT but
    // decorated must still count as present — a false "absent" is the
    // reading that causes a duplicate.
    const wanted = normalise(body);
    return thread.some((m) => hash(m.body) === target || m.normalised.includes(wanted));
  }

  /**
   * Post a comment, safely.
   *
   * @param shadow when true, everything happens except the click.
   */
  async postComment(body: string, shadow: boolean): Promise<PostCommentOutcome> {
    // 1. READ FIRST.
    const before = await this.readThread();
    if (this.present(before, body)) return { kind: 'ALREADY_PRESENT' };

    if (shadow) {
      // Everything above already ran against the real portal: we
      // navigated, read the thread and decided. Only the click is
      // withheld, which is exactly what makes shadow mode evidence.
      return { kind: 'SHADOW', wouldPost: body };
    }

    // 2. WRITE.
    // An INPUT, not a textarea — theirs is a chat composer. The old
    // selector looked only for textareas and would have found nothing,
    // so every reply would have thrown on `fill` rather than posting.
    const box = this.page.locator('input[placeholder="Enter your message"]').first();
    await box.fill(body);
    // Enter, because the send control is an icon with no accessible name
    // and a single-line composer submits on Enter by construction.
    await box.press('Enter');

    // 3. READ BACK.
    return this.readBackOrUnverified(body);
  }

  /**
   * Confirm by reading, or admit we cannot.
   *
   * Never returns CONFIRMED on a hope: if the thread read comes back
   * empty (which a broken selector also produces) the answer is
   * SENT_UNVERIFIED, and the outbox keeps the item as
   * SENT_UNCONFIRMED for the reconciler. Guessing CONFIRMED here would
   * put a permanent tick on an unverified write, which is the exact thing
   * the whole outbox design refuses to do.
   */
  private async readBackOrUnverified(body: string): Promise<PostCommentOutcome> {
    try {
      await this.page.waitForLoadState('networkidle', { timeout: 15_000 });
    } catch {
      // Slow page is not evidence either way; fall through and read.
    }
    const after = await this.readThread();
    if (after.length === 0) {
      return {
        kind: 'SENT_UNVERIFIED',
        reason: 'Read-back found no messages at all — selector miss or a page that did not render',
      };
    }
    if (this.present(after, body)) return { kind: 'CONFIRMED' };
    return {
      kind: 'SENT_UNVERIFIED',
      reason: 'Read-back succeeded but the comment was not in the thread',
    };
  }

  /** Resolve the ticket. Used by the canary's round trip. */
  async resolve(shadow: boolean): Promise<'SHADOW' | 'OK' | 'UNAVAILABLE'> {
    const button = this.page
      .locator('button:has-text("Resolve"), button:has-text("Close ticket")')
      .first();
    if ((await button.count()) === 0) return 'UNAVAILABLE';
    if (shadow) return 'SHADOW';
    await button.click();
    return 'OK';
  }
}
