/**
 * What a READ-ONLY portal probe may click, and how far it may go.
 *
 * ── WHY A GUARD AND NOT CARE ─────────────────────────────────────────
 * The Delhivery billing probe walks pages nobody here has seen. It has to
 * discover them — follow menus, open tabs, press download buttons — and a
 * page it has never seen can put "Pay now" or "Raise dispute" exactly where
 * a download button was expected. Being careful at each call site is how a
 * one-off probe comes to pay an invoice. So every click goes through
 * `judgeClick`, which reads the label of the ELEMENT ITSELF (not the label
 * the caller thought it was clicking), and refuses anything that could
 * change something on their side.
 *
 * The rule is deliberately lopsided: a refused download costs one missing
 * file in the report, which the report names; a permitted write cannot be
 * taken back. So an UNLABELLED control is refused too — an icon with no
 * name is as likely to be a bin as a download.
 */

/**
 * Words that mean an action rather than a read. The owner's list (pay,
 * dispute, raise, submit, delete, cancel, update, save) plus the ones a
 * billing page is likely to carry beside them. Matched as word STARTS, so
 * "Payment", "Cancelled" and "Submitted" are refused too — a tab called
 * "Cancelled invoices" is a read, but refusing it costs one tab.
 */
export const WRITE_LOOKING =
  /\b(pay\w*|dispute\w*|raise\w*|submit\w*|delete\w*|remov\w*|cancel\w*|updat\w*|save\w*|confirm\w*|approv\w*|reject\w*|recharg\w*|top[\s-]?up|add\s+money|reset\w*|send\w*|request\w*|creat\w*|edit\w*|upload\w*|generat\w*|chang\w*|appl(y|ied|ies)\w*|accept\w*|block\w*|deactivat\w*|log\s?out|sign\s?out|proceed\w*|checkout)\b/i;

/** A navigation target that is an action, not a page. */
const NAV_REFUSE =
  /(log-?out|sign-?out|delete|remove|cancel|checkout|recharge|pay-?now|add-?money|top-?up|dispute|raise)/i;

export interface ClickCandidate {
  /** Everything the element says about itself: text, aria-label, title, icon names. */
  readonly label: string;
  readonly tag: string;
  /** The `type` attribute, lower-cased, '' when absent. */
  readonly type: string;
  /** Whether the element sits inside a <form>. */
  readonly inForm: boolean;
}

export type GuardVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/** May this element be clicked by a read-only probe? */
export function judgeClick(c: ClickCandidate): GuardVerdict {
  const label = c.label.replace(/\s+/g, ' ').trim();
  if (label === '') {
    return { allowed: false, reason: 'unlabelled control — could be anything' };
  }
  const m = WRITE_LOOKING.exec(label);
  if (m !== null) {
    return { allowed: false, reason: `label reads as an action ("${m[0]}")` };
  }
  const tag = c.tag.toLowerCase();
  const type = c.type.toLowerCase();
  if ((tag === 'input' || tag === 'button') && (type === 'submit' || type === 'image')) {
    return { allowed: false, reason: 'a form submit control' };
  }
  // A <button> inside a form with no explicit type IS a submit button —
  // the HTML default — whatever its label says.
  if (tag === 'button' && c.inForm && type !== 'button') {
    return { allowed: false, reason: 'a button inside a form (submits by default)' };
  }
  return { allowed: true };
}

/**
 * May the probe GET this url? A GET is a read, except where a url IS an
 * action (a logout link signs the session out; some portals put a
 * cancel or pay action behind a plain link). https only.
 */
export function judgeNavigation(raw: string): GuardVerdict {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { allowed: false, reason: 'not a url' };
  }
  if (u.protocol !== 'https:') return { allowed: false, reason: `${u.protocol} is not https` };
  const m = NAV_REFUSE.exec(`${u.pathname}${u.search}`);
  if (m !== null) return { allowed: false, reason: `the url reads as an action ("${m[0]}")` };
  return { allowed: true };
}

export class ReadOnlyGuardRefusal extends Error {
  constructor(
    readonly label: string,
    readonly reason: string,
  ) {
    super(`refused to click "${label}": ${reason}`);
    this.name = 'ReadOnlyGuardRefusal';
  }
}

export interface ProbeLimits {
  readonly maxPages: number;
  readonly maxDownloads: number;
}

export type BudgetKind = 'PAGES' | 'DOWNLOADS' | 'TIME';

export class ProbeBudgetExhausted extends Error {
  constructor(readonly kind: BudgetKind) {
    super(`probe stopped: ${kind.toLowerCase()} budget used up`);
    this.name = 'ProbeBudgetExhausted';
  }
}

/**
 * How much a probe may do. Pages and downloads are per account; the
 * deadline is the run's, so a slow first account cannot make a second
 * one run past it.
 */
export class ProbeBudget {
  private pages = 0;
  private downloads = 0;

  constructor(
    readonly limits: ProbeLimits,
    private readonly deadlineAt: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Throws when the run is out of time. Cheap; call between steps. */
  checkTime(): void {
    if (this.now() >= this.deadlineAt) throw new ProbeBudgetExhausted('TIME');
  }

  takePage(): void {
    this.checkTime();
    if (this.pages >= this.limits.maxPages) throw new ProbeBudgetExhausted('PAGES');
    this.pages += 1;
  }

  takeDownload(): void {
    this.checkTime();
    if (this.downloads >= this.limits.maxDownloads) throw new ProbeBudgetExhausted('DOWNLOADS');
    this.downloads += 1;
  }

  remainingMs(): number {
    return Math.max(0, this.deadlineAt - this.now());
  }

  used(): { readonly pages: number; readonly downloads: number } {
    return { pages: this.pages, downloads: this.downloads };
  }
}
