import type { Page } from 'playwright';

export interface RaiseTicketInput {
  readonly awbNumber: string;
  /** THEIR category id. Never a label — see the class doc. */
  readonly categoryId: string;
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

/**
 * The raise-ticket modal, driven by the fetched taxonomy.
 *
 * ── SCHEMA-DRIVEN, NOT NINE FLOWS ────────────────────────────────────
 * There are nine issue categories and their availability varies per
 * shipment state. Hard-coding nine paths would mean nine things to
 * re-verify whenever Delhivery reorders a dropdown, and the ninth would
 * be the one nobody noticed had broken. So this drives ONE flow: select
 * the option whose value matches the category ID we were given, fill the
 * body, attach, submit.
 *
 * ── IDS, NEVER LABELS ────────────────────────────────────────────────
 * Selection is by option `value` — Delhivery's own id — with the label
 * used only as a fallback for finding the control. A label match would
 * break silently on a re-wording, and "silently" is the problem: it would
 * pick a NEIGHBOURING category rather than fail, and file the wrong kind
 * of ticket.
 *
 * ── FOUR OUTCOMES, NONE OF THEM ERRORS ───────────────────────────────
 * Created, already exists, not eligible, task pending. All four are
 * normal answers to a reasonable request. Treating any of them as a
 * failure would mean retrying — and retrying "already exists" is how you
 * discover their dedup is per (awb, category) rather than exact.
 *
 * TODO(delhivery-portal): every selector and every outcome string below
 * is inferred and has never run against one.delhivery.com. The four
 * outcomes are real (they are in the brief); how the page SAYS them is
 * the guess.
 */
export class RaiseTicketModal {
  constructor(
    private readonly page: Page,
    private readonly origin = 'https://one.delhivery.com',
  ) {}

  async open(awbNumber: string): Promise<void> {
    await this.page.goto(`${this.origin}/support?awb=${encodeURIComponent(awbNumber)}`, {
      waitUntil: 'domcontentloaded',
    });
    const trigger = this.page
      .locator('button:has-text("Raise"), button:has-text("New ticket"), button:has-text("Create")')
      .first();
    if ((await trigger.count()) > 0) await trigger.click();
  }

  /**
   * Which categories the portal is offering RIGHT NOW for this shipment.
   *
   * This is the eligibility check, and it is a read rather than a rule:
   * availability depends on shipment state, which we do not model and
   * should not try to. Asking is cheaper and cannot drift.
   */
  async offeredCategoryIds(): Promise<{ id: string; label: string }[]> {
    const select = this.page.locator('select[name*="categor" i], select[id*="categor" i]').first();
    if ((await select.count()) === 0) return [];
    const options = select.locator('option');
    const n = await options.count();
    const out: { id: string; label: string }[] = [];
    for (let i = 0; i < n; i += 1) {
      const id = (await options.nth(i).getAttribute('value')) ?? '';
      const label = (await options.nth(i).innerText()).trim();
      if (id !== '') out.push({ id, label });
    }
    return out;
  }

  async raise(input: RaiseTicketInput, shadow: boolean): Promise<RaiseTicketOutcome> {
    const offered = await this.offeredCategoryIds();
    if (offered.length > 0 && !offered.some((o) => o.id === input.categoryId)) {
      // Asked, and told no. Not a failure — this shipment's state simply
      // does not admit this category.
      return {
        kind: 'NOT_ELIGIBLE',
        reason: `Category ${input.categoryId} is not offered for AWB ${input.awbNumber}`,
      };
    }

    if (shadow) {
      // Navigated, opened the modal, read the real offered categories and
      // confirmed ours is among them. Only the submit is withheld.
      return { kind: 'SHADOW', wouldRaise: input };
    }

    await this.page
      .locator('select[name*="categor" i], select[id*="categor" i]')
      .first()
      .selectOption(input.categoryId);

    await this.page.locator('textarea, [role="textbox"]').first().fill(input.body);

    const files = input.attachmentPaths ?? [];
    if (files.length > 0) {
      const upload = this.page.locator('input[type="file"]').first();
      if ((await upload.count()) > 0) await upload.setInputFiles([...files]);
    }

    await this.page
      .locator('button:has-text("Submit"), button:has-text("Raise"), button[type="submit"]')
      .first()
      .click();

    return this.readOutcome();
  }

  /**
   * Read which of the four things happened.
   *
   * Ordered most-specific first: "already exists" and "task" phrasing are
   * checked before a generic success, because a page can say both ("Ticket
   * already exists — created earlier today") and the specific reading is
   * the useful one.
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
   * Returns null rather than guessing. A wrong id bound to an escalation
   * would thread another seller's replies into this conversation, which is
   * worse than having no id at all — the same reasoning as the read
   * pipeline's NO_ESCALATION.
   */
  private async findTicketId(): Promise<string | null> {
    const text = await this.page.locator('body').innerText();
    const m =
      /ticket\s*(?:id|no\.?|number)\s*[:#-]?\s*([A-Z0-9-]{4,24})/i.exec(text) ??
      /#([0-9]{5,12})\b/.exec(text);
    return m?.[1] ?? null;
  }
}
