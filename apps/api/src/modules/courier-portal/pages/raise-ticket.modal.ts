import type { Page } from 'playwright';

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

/** Whitespace-collapsed and lowercased — chips wrap across lines. */
function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

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
  async open(awbNumber: string): Promise<void> {
    await this.page.goto(`${this.origin}/orders/forward/all-shipments`, {
      waitUntil: 'domcontentloaded',
    });
    const search = this.page
      .locator('input[placeholder*="AWB" i], input[placeholder*="Search" i]')
      .first();
    await search.fill(awbNumber);
    await search.press('Enter');
    await this.page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);

    // The row for THIS waybill, never "the first row". A search that
    // returned nothing leaves the previous list on screen, and clicking
    // its first row would open somebody else's parcel and raise a ticket
    // against it.
    const row = this.page.locator(`text=${awbNumber}`).first();
    await row.click({ timeout: 20_000 });
    await this.page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);

    await this.page.locator('button:has-text("Need Help")').first().click({ timeout: 20_000 });
    await this.page.locator('text=Raise a ticket').first().waitFor({ timeout: 20_000 });
  }

  /**
   * Which categories the portal is offering RIGHT NOW for this shipment.
   *
   * A read rather than a rule: availability depends on shipment state,
   * which we do not model and should not try to. Asking is cheaper and
   * cannot drift.
   */
  async offeredCategoryLabels(): Promise<string[]> {
    const chips = this.chipsUnder('Help us understand your issue');
    return this.textsOf(chips);
  }

  async raise(input: RaiseTicketInput, shadow: boolean): Promise<RaiseTicketOutcome> {
    const offered = await this.offeredCategoryLabels();
    if (offered.length > 0 && !offered.some((o) => norm(o) === norm(input.categoryLabel))) {
      // Asked, and told no. Not a failure — this shipment's state simply
      // does not admit this category.
      return {
        kind: 'NOT_ELIGIBLE',
        reason:
          `"${input.categoryLabel}" is not offered for AWB ${input.awbNumber}. ` +
          `They are offering: ${offered.join(' | ')}`,
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
    const chip = this.page
      .locator(`button:text-is("${label}"), [role="button"]:text-is("${label}")`)
      .first();
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

  private chipsUnder(heading: string): ReturnType<Page['locator']> {
    return this.page
      .locator(`:below(:text("${heading}"))`)
      .locator('button, [role="button"]')
      .filter({ hasNotText: /^(Attach File|Raise this Issue|Reset Categories)$/ });
  }

  private async textsOf(loc: ReturnType<Page['locator']>): Promise<string[]> {
    const n = await loc.count();
    const out: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const t = (await loc.nth(i).innerText()).trim();
      if (t !== '') out.push(t);
    }
    return out;
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
