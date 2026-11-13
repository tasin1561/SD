import type { GlossaryTerm, Guide, GuideAudience, GuideSection } from './knowledge.types';

/**
 * The DB OVERLAY over the committed knowledge (guides, glossary, error codes,
 * the console's own text). The committed files stay the BASE and are never
 * written; an overlay is what the owner has approved on top of them:
 *
 *   - guide entries: a new guide, or one with the id of a base guide, which
 *     REPLACES that guide in the help search (an edit);
 *   - glossary terms: new, or the same term as a base one, which replaces it;
 *   - prompt addenda: a few short lines added to the end of the system prompt
 *     for the named audiences.
 *
 * A version of the overlay is a FULL snapshot (`assistant_knowledge_versions.content`),
 * immutable once stored. This file is pure: no database, no clock.
 */

export interface OverlayAddendum {
  readonly id: string;
  readonly audiences: readonly GuideAudience[];
  readonly text: string;
}

export interface KnowledgeOverlay {
  readonly guides: readonly Guide[];
  readonly glossary: readonly GlossaryTerm[];
  readonly addenda: readonly OverlayAddendum[];
}

export const EMPTY_OVERLAY: KnowledgeOverlay = { guides: [], glossary: [], addenda: [] };

/** Hard limits: an overlay is a patch, not a second knowledge base. */
export const OVERLAY_LIMITS = {
  addenda: 8,
  addendumChars: 400,
  guides: 40,
  glossary: 80,
  sectionsPerGuide: 8,
  stepsPerSection: 12,
  stepChars: 300,
  titleChars: 120,
  summaryChars: 300,
  headingChars: 120,
  termChars: 80,
  meaningChars: 500,
  exampleChars: 300,
} as const;

export const GUIDE_AUDIENCES: readonly GuideAudience[] = ['staff', 'seller', 'store', 'associate'];

/** What a drafted knowledge change looks like once parsed (see `assistant-recommendation-draft.ts`). */
export type KnowledgeChange =
  | {
      readonly target: 'guide';
      readonly audiences: readonly GuideAudience[];
      /** The id of the guide this EDITS (base or overlay); null = a new guide. */
      readonly guideId: string | null;
      readonly title: string;
      readonly summary: string;
      readonly sections: readonly GuideSection[];
    }
  | {
      readonly target: 'glossary';
      readonly audiences: readonly GuideAudience[];
      readonly term: string;
      readonly meaning: string;
      readonly example: string;
    }
  | {
      readonly target: 'prompt_addendum';
      readonly audiences: readonly GuideAudience[];
      readonly text: string;
    };

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  // Control characters have no place in help text; whitespace is collapsed.
  const t = stripControl(v).trim();
  return t === '' || t.length > max ? null : t;
};

export function parseAudiences(v: unknown): GuideAudience[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > GUIDE_AUDIENCES.length) return null;
  const out: GuideAudience[] = [];
  for (const a of v) {
    if (typeof a !== 'string' || !(GUIDE_AUDIENCES as readonly string[]).includes(a)) return null;
    if (!out.includes(a as GuideAudience)) out.push(a as GuideAudience);
  }
  return out;
}

function parseSections(v: unknown): GuideSection[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > OVERLAY_LIMITS.sectionsPerGuide)
    return null;
  const out: GuideSection[] = [];
  for (const s of v) {
    if (!isObject(s)) return null;
    const heading = str(s['heading'], OVERLAY_LIMITS.headingChars);
    const steps = s['steps'];
    if (heading === null || !Array.isArray(steps)) return null;
    if (steps.length === 0 || steps.length > OVERLAY_LIMITS.stepsPerSection) return null;
    const clean: string[] = [];
    for (const st of steps) {
      const t = str(st, OVERLAY_LIMITS.stepChars);
      if (t === null) return null;
      clean.push(t);
    }
    out.push({ heading, steps: clean });
  }
  return out;
}

/** Strict parse of one change; null when anything is missing, the wrong type, or over its limit. */
export function parseKnowledgeChange(raw: unknown): KnowledgeChange | null {
  if (!isObject(raw)) return null;
  const audiences = parseAudiences(raw['audiences']);
  if (audiences === null) return null;
  switch (raw['target']) {
    case 'guide': {
      const title = str(raw['title'], OVERLAY_LIMITS.titleChars);
      const summary = str(raw['summary'], OVERLAY_LIMITS.summaryChars);
      const sections = parseSections(raw['sections']);
      const gid = raw['guideId'];
      const guideId = gid === null ? null : str(gid, 80);
      if (title === null || summary === null || sections === null) return null;
      if (gid !== null && (guideId === null || !/^[a-z0-9][a-z0-9-]*$/.test(guideId))) return null;
      return { target: 'guide', audiences, guideId, title, summary, sections };
    }
    case 'glossary': {
      const term = str(raw['term'], OVERLAY_LIMITS.termChars);
      const meaning = str(raw['meaning'], OVERLAY_LIMITS.meaningChars);
      const example = str(raw['example'], OVERLAY_LIMITS.exampleChars);
      if (term === null || meaning === null || example === null) return null;
      return { target: 'glossary', audiences, term, meaning, example };
    }
    case 'prompt_addendum': {
      const text = str(raw['text'], OVERLAY_LIMITS.addendumChars);
      if (text === null) return null;
      return { target: 'prompt_addendum', audiences, text };
    }
    default:
      return null;
  }
}

/** Parse a stored overlay back; anything unreadable is an empty overlay (the base alone), never a throw. */
export function parseOverlay(raw: unknown): KnowledgeOverlay {
  if (!isObject(raw)) return EMPTY_OVERLAY;
  const guides: Guide[] = [];
  for (const g of Array.isArray(raw['guides']) ? raw['guides'] : []) {
    if (!isObject(g)) continue;
    const audience = parseAudiences(g['audience']);
    const sections = parseSections(g['sections']);
    const id = str(g['id'], 80);
    const title = str(g['title'], OVERLAY_LIMITS.titleChars);
    const summary = str(g['summary'], OVERLAY_LIMITS.summaryChars);
    if (audience === null || sections === null || id === null || title === null || summary === null)
      continue;
    guides.push({ id, audience, title, summary, sections, sources: [] });
  }
  const glossary: GlossaryTerm[] = [];
  for (const t of Array.isArray(raw['glossary']) ? raw['glossary'] : []) {
    if (!isObject(t)) continue;
    const audience = parseAudiences(t['audience']);
    const term = str(t['term'], OVERLAY_LIMITS.termChars);
    const meaning = str(t['meaning'], OVERLAY_LIMITS.meaningChars);
    const example = str(t['example'], OVERLAY_LIMITS.exampleChars);
    if (audience === null || term === null || meaning === null || example === null) continue;
    glossary.push({ term, audience, meaning, example });
  }
  const addenda: OverlayAddendum[] = [];
  for (const a of Array.isArray(raw['addenda']) ? raw['addenda'] : []) {
    if (!isObject(a)) continue;
    const audiences = parseAudiences(a['audiences']);
    const id = str(a['id'], 40);
    const text = str(a['text'], OVERLAY_LIMITS.addendumChars);
    if (audiences === null || id === null || text === null) continue;
    addenda.push({ id, audiences, text });
  }
  return { guides, glossary, addenda };
}

/** The JSON stored in `content` (guide `sources` are for reviewers and are not kept). */
export function overlayToJson(o: KnowledgeOverlay): Record<string, unknown> {
  return {
    guides: o.guides.map((g) => ({
      id: g.id,
      audience: g.audience,
      title: g.title,
      summary: g.summary,
      sections: g.sections,
    })),
    glossary: o.glossary.map((t) => ({
      term: t.term,
      audience: t.audience ?? GUIDE_AUDIENCES,
      meaning: t.meaning,
      example: t.example,
    })),
    addenda: o.addenda,
  };
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

export class OverlayLimitError extends Error {}

/** The overlay after `change`: a NEW object, the input is never touched. */
export function applyChange(base: KnowledgeOverlay, change: KnowledgeChange): KnowledgeOverlay {
  switch (change.target) {
    case 'guide': {
      const id = change.guideId ?? `overlay-${slug(change.title) || 'guide'}`;
      const guide: Guide = {
        id,
        audience: change.audiences,
        title: change.title,
        summary: change.summary,
        sections: change.sections,
        sources: [],
      };
      const guides = base.guides.some((g) => g.id === id)
        ? base.guides.map((g) => (g.id === id ? guide : g))
        : [...base.guides, guide];
      if (guides.length > OVERLAY_LIMITS.guides) throw new OverlayLimitError('too many guides');
      return { ...base, guides };
    }
    case 'glossary': {
      const same = (t: GlossaryTerm): boolean => t.term.toLowerCase() === change.term.toLowerCase();
      const term: GlossaryTerm = {
        term: change.term,
        audience: change.audiences,
        meaning: change.meaning,
        example: change.example,
      };
      const glossary = base.glossary.some(same)
        ? base.glossary.map((t) => (same(t) ? term : t))
        : [...base.glossary, term];
      if (glossary.length > OVERLAY_LIMITS.glossary) throw new OverlayLimitError('too many terms');
      return { ...base, glossary };
    }
    case 'prompt_addendum': {
      if (base.addenda.some((a) => a.text === change.text)) return base;
      if (base.addenda.length >= OVERLAY_LIMITS.addenda)
        throw new OverlayLimitError('too many prompt additions');
      let n = base.addenda.length + 1;
      while (base.addenda.some((a) => a.id === `a${n}`)) n++;
      return {
        ...base,
        addenda: [...base.addenda, { id: `a${n}`, audiences: change.audiences, text: change.text }],
      };
    }
  }
}

/** The audience letter-case the prompt and the help index use. */
const GUIDE_AUDIENCE_OF: Readonly<Record<string, GuideAudience>> = {
  STAFF: 'staff',
  SELLER: 'seller',
  STORE: 'store',
  ASSOCIATE: 'associate',
};

/** The addenda one console's prompt carries, in the order they were approved. PUBLIC never gets any. */
export function addendaFor(overlay: KnowledgeOverlay | null, audience: string): string[] {
  if (overlay === null) return [];
  const a = GUIDE_AUDIENCE_OF[audience];
  if (a === undefined) return [];
  return overlay.addenda.filter((x) => x.audiences.includes(a)).map((x) => x.text);
}

/** Lines the owner reads as a diff for one change against what it replaces (or nothing for an addition). */
export function describeChange(
  change: KnowledgeChange,
  before: KnowledgeOverlay,
  base: { readonly guides: readonly Guide[]; readonly glossary: readonly GlossaryTerm[] },
): { readonly before: string | null; readonly after: string; readonly isEdit: boolean } {
  switch (change.target) {
    case 'guide': {
      const prev =
        change.guideId === null
          ? null
          : (before.guides.find((g) => g.id === change.guideId) ??
            base.guides.find((g) => g.id === change.guideId) ??
            null);
      return {
        before: prev === null ? null : renderGuide(prev),
        after: renderGuide(change),
        isEdit: prev !== null,
      };
    }
    case 'glossary': {
      const same = (t: GlossaryTerm): boolean => t.term.toLowerCase() === change.term.toLowerCase();
      const prev = before.glossary.find(same) ?? base.glossary.find(same) ?? null;
      return {
        before: prev === null ? null : `${prev.term}: ${prev.meaning} Example: ${prev.example}`,
        after: `${change.term}: ${change.meaning} Example: ${change.example}`,
        isEdit: prev !== null,
      };
    }
    case 'prompt_addendum':
      return { before: null, after: change.text, isEdit: false };
  }
}

function renderGuide(g: {
  readonly title: string;
  readonly summary: string;
  readonly sections: readonly GuideSection[];
}): string {
  return [
    g.title,
    g.summary,
    ...g.sections.flatMap((s) => [`## ${s.heading}`, ...s.steps.map((x) => `- ${x}`)]),
  ].join('\n');
}

/** Drops control characters (keeps tab, newline, carriage return). */
function stripControl(v: string): string {
  return [...v]
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return (c >= 32 || c === 9 || c === 10 || c === 13) && c !== 127;
    })
    .join('');
}
