/**
 * Section 14 — Reseller stores. Words are the app's own (apps/seller,
 * apps/reseller): "Reseller stores" / "Other businesses that sell your stock
 * under their own name, with their own login." One file, owned by the
 * section: `src/content/sections/reseller.ts`, re-exported by `site.ts`.
 */
export interface ResellerBeat {
  id: string;
  ms?: number;
  /** The short line in the list beside the mock — never the caption again. */
  step: string;
  /** The sentence the frame reads aloud while this beat is on screen. */
  caption: string;
}

export interface ResellerCapability {
  /** The seller's own wording for the task, e.g. "Call the customer again". */
  task: string;
  /** The 3A task it maps to, or null when the page shows it but 3A does not claim it. */
  claims: string | null;
}

/** One of the four static cards above the demo. */
export interface ResellerCard {
  id: string;
  title: string;
  /** One sentence. The app's own words wherever they exist. */
  line: string;
}

export interface ResellerSectionContent {
  title: string;
  promise: string;
  /** The two-party colouring: seller = blue, store = violet. */
  sellerHue: 'blue';
  storeHue: 'violet';
  /** The seven capabilities of the action-policy screen, in the app's order. */
  capabilities: readonly ResellerCapability[];
  /** The two questions the seller is asked per task, verbatim. */
  policyQuestions: { can: string; how: string; direct: string; approval: string };
  /** The store's catalogue columns, verbatim. */
  storeColumns: readonly string[];
  /** The two columns the store's own screens do not carry at all. */
  hiddenColumns: readonly string[];
  /** Credit timing options, verbatim (`CREDIT_TRIGGERS`). */
  creditTriggers: readonly string[];
  /** The six fee labels of the terms screen, in the app's order (`FEE_FIELDS`). */
  fees: readonly string[];
  /** The static cards the server renders above the demo. */
  cards: readonly ResellerCard[];
  /** One line under the demo saying its figures are illustrative. */
  note: string;
  beats: readonly ResellerBeat[];
}
