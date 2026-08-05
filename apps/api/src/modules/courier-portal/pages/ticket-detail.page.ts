import type { Page } from 'playwright';
import { createHash } from 'node:crypto';

/** What a read of the thread gives us. */
export interface PortalThreadMessage {
  readonly body: string;
  readonly normalised: string;
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
 * ── SELECTORS ARE A GUESS ────────────────────────────────────────────
 * TODO(delhivery-portal): every selector in this file is inferred from
 * ordinary support-desk markup and has never been run against
 * one.delhivery.com. They are deliberately broad (several candidates per
 * element, `:has-text` over class names) because a brittle selector fails
 * as "no messages found", which read-before-write would then interpret as
 * "not present" — and that is the one misreading that could cause a
 * duplicate. Correct these against the real DOM before LIVE.
 */
export class TicketDetailPage {
  constructor(
    private readonly page: Page,
    private readonly origin = 'https://one.delhivery.com',
  ) {}

  async open(externalTicketId: string): Promise<void> {
    await this.page.goto(`${this.origin}/support/${encodeURIComponent(externalTicketId)}`, {
      waitUntil: 'domcontentloaded',
    });
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
    const candidates = [
      '[data-testid="ticket-message"]',
      '.ticket-comment',
      '.comment-body',
      '[class*="message"] [class*="body"]',
    ];
    for (const sel of candidates) {
      const nodes = this.page.locator(sel);
      const n = await nodes.count();
      if (n === 0) continue;
      const out: PortalThreadMessage[] = [];
      for (let i = 0; i < n; i += 1) {
        const text = (await nodes.nth(i).innerText()).trim();
        if (text !== '') out.push({ body: text, normalised: normalise(text) });
      }
      if (out.length > 0) return out;
    }
    return [];
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
    const box = this.page
      .locator('textarea[name="comment"], textarea[placeholder*="comment" i], [role="textbox"]')
      .first();
    await box.fill(body);
    await this.page
      .locator('button:has-text("Submit"), button:has-text("Send"), button[type="submit"]')
      .first()
      .click();

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
