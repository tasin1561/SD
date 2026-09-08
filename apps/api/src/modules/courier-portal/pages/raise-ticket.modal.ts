import type { Page } from 'playwright';
import { gotoPortal } from './navigate';

export interface RaiseTicketInput {
  readonly awbNumber: string;
  /**
   * THEIR label for the category, exactly as the chip reads.
   *
   * A label and not an id, and that is forced rather than chosen: their
   * modal offers chips with text on them and no value attribute to
   * match — see the class doc for what stops a near-miss.
   */
  readonly categoryLabel: string;
  /** The chip under "Select a subcategory". Null when they offer none. */
  readonly subcategoryLabel: string | null;
  readonly body: string;
  /** Absolute paths. Damage and fake-remark cases depend on photos. */
  readonly attachmentPaths?: readonly string[];
}

export type RaiseTicketOutcome =
  | { readonly kind: 'CREATED'; readonly externalTicketId: string | null }
  /** Their dedup fired — roughly per (awb, category). NOT an error. */
  | { readonly kind: 'ALREADY_EXISTS'; readonly externalTicketId: string | null }
  /** This category is not offered for this shipment's state. NOT an error. */
  | { readonly kind: 'NOT_ELIGIBLE'; readonly reason: string }
  /** Creation is async and landed in their Tasks list. NOT an error. */
  | { readonly kind: 'TASK_PENDING'; readonly taskRef: string | null }
  | { readonly kind: 'SHADOW'; readonly wouldRaise: RaiseTicketInput };

/** Their ticket id as a person reads it: `J1788584000522861`. */
const TICKET_ID_RE = /\bJ\d{12,20}\b/;

/**
 * Delhivery ONE's "Raise a ticket" modal.
 *
 * ── IT IS A CONVERSATION, NOT A FORM ─────────────────────────────────
 * The first version of this file drove a `<select>` and a Submit button,
 * which is what a support form usually looks like and is not what this
 * is. Their modal is a chat: it asks "Help us understand your issue" and
 * offers CHIPS; clicking one echoes it back as your own message and the
 * next question appears. Category, then subcategory, then a free-text
 * box capped at 300 characters, then "Raise this Issue". Four steps,
 * each revealed by the one before, so there is nothing to fill in
 * up-front and no way to skip ahead.
 *
 * ── LABELS, BECAUSE THERE ARE NO IDS ─────────────────────────────────
 * The old file said "IDS, NEVER LABELS" and was right about the danger:
 * matching on text breaks silently on a re-wording, and silently means
 * picking a NEIGHBOURING chip and filing the wrong kind of ticket. But
 * the chips carry no value attribute, so the choice is not available.
 *
 * What replaces it is the modal's own echo. Every chip clicked comes
 * back as a message bubble with its text, so after clicking we READ THAT
 * BACK and refuse unless it matches what we meant to pick. A re-wording
 * now fails loudly at the click instead of quietly at the desk. The
 * labels themselves come from `courier_issue_categories`, which is their
 * taxonomy as we last fetched it — not a list typed in here.
 *
 * ── FOUR OUTCOMES, NONE OF THEM ERRORS ───────────────────────────────
 * Created, already exists, not eligible, task pending. All four are
 * normal answers to a reasonable request, and retrying "already exists"
 * is how you discover their dedup is per (awb, category) rather than
 * exact.
 *
 * TODO(delhivery-portal): the STEPS and the visible text are taken from
 * the real portal (2026-09-06). The CSS beneath them is still inferred —
 * every locator below is anchored on text a person can see rather than
 * on a class name, precisely because the text is the part that has been
 * confirmed.
 *
 * This is the ONE page object still unproven, and it is unproven for a
 * reason: verifying it means clicking "Raise this Issue", which files a
 * real ticket with Delhivery's support desk. The READ path was probed
 * end to end because reading costs them nothing; this half waits for a
 * deliberate first parcel, which is what `portalMode: LIVE` gates.
 */
export class RaiseTicketModal {
  constructor(
    private readonly page: Page,
    private readonly origin = 'https://one.delhivery.com',
  ) {}

  /**
   * Get to the modal for one waybill.
   *
   * Via the ORDER, because that is the only route that binds the ticket
   * to a parcel: the modal stamps "Orders Involved: <awb>" from the page
   * it was opened on, and a ticket raised without one is a paragraph
   * their desk cannot act on. Search the forward-orders list for the AWB,
   * open the single result, then "Need Help".
   */
  /**
   * Settle, and wait for their SPINNER to go.
   *
   * `networkidle` is not enough on its own and that cost a verification
   * run: their list renders, the network goes quiet, and a full-screen
   * `.ap-loading__overlay` is still up intercepting every click.
   * Playwright reports the row as "visible, enabled and stable" and then
   * retries the click for twenty seconds against something invisible on
   * top of it — a failure that reads like a missing row rather than a
   * covered one.
   */
  private async settle(): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    await this.page
      .locator('.ap-loading__overlay')
      .waitFor({ state: 'detached', timeout: 20_000 })
      .catch(() => undefined);
  }

  async open(awbNumber: string): Promise<void> {
    /*
      VIA THE HEADER SEARCH, NOT THE ORDERS LIST.

      The first version searched a list at `/orders/forward/all-shipments`
      and clicked the matching row. Verified against the live portal, that
      path does not work at all: that URL renders NO list (their real tabs
      are delivered / in-transit / ready-to-ship / …), and even on a tab
      that does render, a parcel is only in ONE of them — so finding an
      order would mean knowing its state first, which is the thing we are
      opening the order to find out.

      Worse, it failed in the shape that hides itself. A search that
      returns nothing leaves the PREVIOUS list on screen, so `text=<awb>`
      matched a stale row and the run looked like it had found the parcel.
      That is how the first verification pass "passed".

      Their header search is state-independent and is what a person uses:
      type the waybill, a suggestion appears, click it, and you are on the
      order. Confirmed end to end on 2026-09-06.
    */
    await gotoPortal(this.page, `${this.origin}/orders/forward/delivered`);
    await this.settle();

    const header = this.page.locator('input[placeholder="Search multiple AWBs"]').first();
    await header.waitFor({ state: 'visible', timeout: 20_000 });
    await header.fill(awbNumber);

    // Their suggestion list is debounced and renders as `AWB <number>`.
    // Matched on that exact string so a partial match on another parcel
    // cannot be clicked — opening the wrong order would raise a ticket
    // against somebody else's parcel.
    const suggestion = this.page.locator(`text=AWB ${awbNumber}`).first();
    await suggestion.waitFor({ state: 'visible', timeout: 20_000 });
    await suggestion.click();

    // Their router lands on /orders/forward/<uuid>.
    await this.page.waitForURL(/\/orders\/forward\/[0-9a-f-]{20,}/, { timeout: 30_000 });
    await this.settle();

    await this.page.locator('button:has-text("Need Help")').first().click({ timeout: 20_000 });
    await this.page.locator('text=Raise a ticket').first().waitFor({ timeout: 20_000 });
    await this.page.waitForTimeout(1_500);
  }

  /**
   * Is the portal offering this category for this shipment RIGHT NOW?
   *
   * A read rather than a rule: availability depends on shipment state,
   * which we do not model and should not try to. Asking is cheaper and
   * cannot drift.
   *
   * By EXACT TEXT, on any element. Their chips are not `<button>`s and
   * carry no role — verified against the live modal, where a
   * `button, [role="button"]` scan found fourteen controls belonging to
   * the ORDER PAGE BEHIND the modal and none of the chips. Matching the
   * text is what actually finds them.
   */
  async isOffered(label: string): Promise<boolean> {
    return (await this.chip(label).count()) > 0;
  }

  /**
   * Every category chip the modal is showing, for the taxonomy fetch.
   *
   * Read from the block under their "SHIPMENT ISSUE" heading rather than
   * by element type — the chips are plain elements with click handlers,
   * so there is nothing to select on but position and text.
   *
   * Returns [] when the block cannot be found, and the caller treats
   * that as "learned nothing" rather than "they offer nothing": an empty
   * read and an empty list are indistinguishable here, and deleting a
   * taxonomy on a selector miss would be far worse than not updating it.
   */
  async offeredCategoryLabels(): Promise<string[]> {
    // Locators, not `page.evaluate`: the API's tsconfig carries no DOM
    // lib, so `document` does not exist in this codebase at all — and
    // adding it to reach into a third party's page would put every
    // browser global in scope for a Node service.
    const heading = this.page.getByText('SHIPMENT ISSUE', { exact: true }).first();
    if ((await heading.count()) === 0) return [];
    const leaves = heading.locator('xpath=..').locator('xpath=.//*[not(*)]');
    const n = await leaves.count();
    const out: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < n; i += 1) {
      const t = (
        await leaves
          .nth(i)
          .innerText()
          .catch(() => '')
      )
        .replace(/\s+/g, ' ')
        .trim();
      if (t === '' || t === 'SHIPMENT ISSUE' || t.length > 90) continue;
      // Their timestamp line sits in the same block.
      if (/^\d{1,2} \w+, \d{4}/.test(t)) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  }

  /** The chip itself. `.first()`, because a clicked chip is echoed. */
  private chip(label: string) {
    return this.page.getByText(label, { exact: true }).first();
  }

  async raise(input: RaiseTicketInput, shadow: boolean): Promise<RaiseTicketOutcome> {
    if (!(await this.isOffered(input.categoryLabel))) {
      // Asked, and told no. Not a failure — this shipment's state simply
      // does not admit this category.
      return {
        kind: 'NOT_ELIGIBLE',
        reason: `"${input.categoryLabel}" is not offered for AWB ${input.awbNumber}`,
      };
    }

    if (shadow) {
      // Navigated, opened the modal, read the real offered categories and
      // confirmed ours is among them. Only the clicks are withheld, which
      // is exactly what makes shadow mode evidence rather than a dry run.
      return { kind: 'SHADOW', wouldRaise: input };
    }

    const picked = await this.pickChip(input.categoryLabel);
    if (!picked) {
      return {
        kind: 'NOT_ELIGIBLE',
        reason: `The category chip "${input.categoryLabel}" did not take — their wording has moved`,
      };
    }

    if (input.subcategoryLabel !== null) {
      const sub = await this.pickChip(input.subcategoryLabel);
      if (!sub) {
        return {
          kind: 'NOT_ELIGIBLE',
          reason: `The subcategory chip "${input.subcategoryLabel}" did not take`,
        };
      }
    }

    // Their box is capped at 300. Cut HERE rather than letting the field
    // silently drop the tail, so what we believe we sent and what they
    // received are the same string.
    const box = this.page.locator('textarea').last();
    await box.waitFor({ timeout: 20_000 });
    await box.fill(input.body.slice(0, 300));

    const files = input.attachmentPaths ?? [];
    if (files.length > 0) {
      const upload = this.page.locator('input[type="file"]').first();
      if ((await upload.count()) > 0) await upload.setInputFiles([...files]);
    }

    await this.page.locator('button:has-text("Raise this Issue")').first().click();

    return this.readOutcome();
  }

  /**
   * Click a chip and make the portal confirm which one it took.
   *
   * The echo is the whole safety property. Their modal repeats every
   * choice back as your own message, so a click that landed on a
   * neighbouring chip — the failure a text match invites — is visible
   * immediately rather than at their desk a day later. Returns false
   * instead of throwing: a chip that will not take is "not eligible",
   * which is an answer, not a fault.
   */
  private async pickChip(label: string): Promise<boolean> {
    const chip = this.chip(label);
    if ((await chip.count()) === 0) return false;
    await chip.click();

    try {
      // The echo carries the SAME text; waiting for a second occurrence
      // is what distinguishes "clicked" from "still just the chip".
      await this.page.locator(`text=${label}`).nth(1).waitFor({ timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read which of the four things happened.
   *
   * Ordered most-specific first: "already exists" and "task" phrasing are
   * checked before a generic success, because a page can say both
   * ("Ticket already exists — created earlier today") and the specific
   * reading is the useful one.
   */
  private async readOutcome(): Promise<RaiseTicketOutcome> {
    try {
      await this.page.waitForLoadState('networkidle', { timeout: 15_000 });
    } catch {
      // Not evidence either way.
    }
    const text = (await this.page.locator('body').innerText()).toLowerCase();

    if (/already (exists|raised|been raised)|duplicate ticket/.test(text)) {
      return { kind: 'ALREADY_EXISTS', externalTicketId: await this.findTicketId() };
    }
    if (/not eligible|cannot be raised|not applicable/.test(text)) {
      return { kind: 'NOT_ELIGIBLE', reason: 'The portal reported the category is not eligible' };
    }
    if (/task|queued|being processed|will be processed/.test(text)) {
      return { kind: 'TASK_PENDING', taskRef: await this.findTicketId() };
    }
    return { kind: 'CREATED', externalTicketId: await this.findTicketId() };
  }

  /**
   * Their ticket id, if the page shows one.
   *
   * Matched on their actual shape — `J` and a long run of digits — not
   * on a "Ticket ID:" preamble, because the support list prints the id
   * on its own with the waybill beneath it and no label at all.
   *
   * Returns null rather than guessing. A wrong id bound to an escalation
   * would thread another seller's replies into this conversation, which
   * is worse than having no id at all.
   */
  private async findTicketId(): Promise<string | null> {
    const text = await this.page.locator('body').innerText();
    return TICKET_ID_RE.exec(text)?.[0] ?? null;
  }
}
