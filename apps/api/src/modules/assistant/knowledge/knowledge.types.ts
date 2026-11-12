export type GuideAudience = 'staff' | 'seller' | 'store' | 'associate';

export interface GuideSection {
  readonly heading: string;
  /** Short plain-English sentences. One step or one fact each. */
  readonly steps: readonly string[];
}

/**
 * A hand-written workflow guide.
 *
 * Every factual claim in it must come from a file in this repository, and
 * `sources` lists those files (repo-root-relative). `assistant-guides.spec.ts`
 * fails if a listed path no longer exists, so a citation cannot rot silently.
 * `sources` are for REVIEWERS: they are never sent to the model or a user.
 *
 * A client-facing guide (audience without 'staff' only) carries NOTHING
 * internal: no invariant ids, no table names, no security detail, no other
 * clients. `assistant-guides.spec.ts` scans for the obvious shapes.
 */
export interface Guide {
  readonly id: string;
  readonly audience: readonly GuideAudience[];
  readonly title: string;
  readonly summary: string;
  readonly sections: readonly GuideSection[];
  /** Extra search words (English synonyms) that the body does not use. */
  readonly keywords?: readonly string[];
  /** Error-code domain prefixes this guide explains (see domains.ts). */
  readonly errorDomains?: readonly string[];
  readonly sources: readonly string[];
}

export interface GlossaryTerm {
  readonly term: string;
  readonly audience?: readonly GuideAudience[];
  readonly meaning: string;
  readonly example: string;
}
