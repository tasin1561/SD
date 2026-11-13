import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectReplyLanguage } from './assistant-language';

/**
 * The saved language eval's CASES and SCORING. They live in `src` (not only in
 * `scripts/assistant-eval.ts`) because two things use them: the command-line
 * runner, which asks a running API, and the recommendations gate, which asks
 * the chat service in-process. One definition of "this answer passes", so the
 * gate and the saved eval can never disagree. `scripts/assistant-eval.ts`
 * re-exports everything here.
 */
export const EVAL_LANGUAGES = ['en', 'bn', 'banglish', 'hi', 'hinglish'] as const;
export type EvalLanguage = (typeof EVAL_LANGUAGES)[number];
export const EVAL_AUDIENCES = ['staff', 'seller', 'store', 'associate'] as const;
export type EvalAudience = (typeof EVAL_AUDIENCES)[number];
export const EVAL_KINDS = ['language', 'where', 'error', 'refusal'] as const;
export type EvalKind = (typeof EVAL_KINDS)[number];

export interface EvalCase {
  readonly id: string;
  readonly audience: EvalAudience;
  readonly language: EvalLanguage;
  readonly kind: EvalKind;
  readonly question: string;
  /** Every one of these page paths must appear as a link in the answer. */
  readonly expectLinks?: readonly string[];
  /** Every one of these words must appear (case-insensitive). */
  readonly expectAll?: readonly string[];
  /** At least one of these words must appear (case-insensitive). */
  readonly mustContainAny?: readonly string[];
  /** None of these may appear (case-insensitive). */
  readonly forbidden?: readonly string[];
  readonly note?: string;
}

/** apps/api/eval/assistant — the same depth from `src/modules/assistant` and from `dist/modules/assistant`. */
export const EVAL_CASE_DIR = join(__dirname, '../../../eval/assistant');
export const BENGALI = /[ঀ-৿]/g;
// Without U+0964/0965 (the danda): Bangla uses it too, so it says nothing about the script.
export const DEVANAGARI = /[ऀ-ॣ०-ॿ]/g;

export function loadCases(dir: string = EVAL_CASE_DIR): EvalCase[] {
  const out: EvalCase[] = [];
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith('.json'))
    .sort()) {
    const parsed = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { cases: EvalCase[] };
    out.push(...parsed.cases);
  }
  return out;
}

function count(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

/** Problems with a set of case files; empty when they are sound. */
export function validateCases(cases: readonly EvalCase[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const c of cases) {
    const at = `case "${c.id}"`;
    if (typeof c.id !== 'string' || c.id === '') problems.push('a case has no id');
    if (seen.has(c.id)) problems.push(`${at}: duplicate id`);
    seen.add(c.id);
    if (!EVAL_AUDIENCES.includes(c.audience)) problems.push(`${at}: bad audience`);
    if (!EVAL_LANGUAGES.includes(c.language)) problems.push(`${at}: bad language`);
    if (!EVAL_KINDS.includes(c.kind)) problems.push(`${at}: bad kind`);
    if (typeof c.question !== 'string' || c.question.trim() === '' || c.question.length > 2000) {
      problems.push(`${at}: question missing or over 2000 characters`);
      continue;
    }
    const bn = count(c.question, BENGALI);
    const hi = count(c.question, DEVANAGARI);
    if (c.language === 'bn' && (bn === 0 || hi > 0)) problems.push(`${at}: not Bangla script`);
    if (c.language === 'hi' && (hi === 0 || bn > 0)) problems.push(`${at}: not Devanagari`);
    if (!['bn', 'hi'].includes(c.language) && bn + hi > 0)
      problems.push(`${at}: a ${c.language} question must be in Latin letters`);
    for (const p of c.expectLinks ?? [])
      if (!/^\/[A-Za-z0-9/_-]*$/.test(p)) problems.push(`${at}: link "${p}" is not a path`);
    const checks =
      (c.expectLinks?.length ?? 0) +
      (c.expectAll?.length ?? 0) +
      (c.mustContainAny?.length ?? 0) +
      (c.forbidden?.length ?? 0);
    if (c.kind !== 'language' && checks === 0) problems.push(`${at}: nothing to check`);
    if (c.kind === 'where' && (c.expectLinks?.length ?? 0) === 0)
      problems.push(`${at}: a where-case needs expectLinks`);
    if (c.kind === 'error' && (c.expectAll?.length ?? 0) === 0)
      problems.push(`${at}: an error-case needs expectAll`);
    if (c.kind === 'refusal' && (c.forbidden?.length ?? 0) === 0)
      problems.push(`${at}: a refusal-case needs forbidden`);
  }
  return problems;
}

// ---------------------------------------------------------------- scoring

const BANGLISH_EXTRA = [
  'korun',
  'korte',
  'kore',
  'hoy',
  'jabe',
  'pabe',
  'dekhte',
  'thakbe',
  'kono',
  'ekhane',
  'shob',
  'sob',
  'tarpor',
  'tahole',
  'niche',
  'upore',
  'apnar',
  'apni',
  'hobe',
  'ache',
  'jonno',
];
const HINGLISH_EXTRA = [
  'karein',
  'kariye',
  'sakte',
  'sakta',
  'aapko',
  'aapka',
  'yahan',
  'wahan',
  'neeche',
  'upar',
  'phir',
  'toh',
  'mein',
  'liye',
  'hai',
  'hain',
  'kijiye',
  'dekhein',
];

function wordHits(text: string, words: readonly string[]): number {
  const found = new Set(text.toLowerCase().match(/[a-z]+/g) ?? []);
  return words.filter((w) => found.has(w)).length;
}

export function languageMatches(expected: EvalLanguage, answer: string): boolean {
  const bn = count(answer, BENGALI);
  const hi = count(answer, DEVANAGARI);
  const letters = Math.max(count(answer, /\p{L}/gu), 1);
  switch (expected) {
    case 'bn':
      return bn / letters >= 0.3 && hi === 0;
    case 'hi':
      return hi / letters >= 0.3 && bn === 0;
    case 'en':
      return bn + hi === 0 && wordHits(answer, ['korun', 'kore', 'karein', 'kijiye']) === 0;
    case 'banglish':
      return (
        bn + hi === 0 &&
        (detectReplyLanguage(answer) === 'bnLatn' || wordHits(answer, BANGLISH_EXTRA) >= 2)
      );
    case 'hinglish':
      return (
        bn + hi === 0 &&
        (detectReplyLanguage(answer) === 'hiLatn' || wordHits(answer, HINGLISH_EXTRA) >= 2)
      );
  }
}

export function linkPresent(links: readonly string[], expected: string): boolean {
  return links.some((l) => {
    const path = l.split(/[?#]/)[0] ?? l;
    return path === expected || path.startsWith(`${expected}/`);
  });
}

export function extractLinks(text: string): string[] {
  return [...text.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1] ?? '');
}

export interface Answer {
  readonly text: string;
  /** Page paths from markdown links and from notices. */
  readonly links: readonly string[];
}

export interface Verdict {
  readonly languageOk: boolean;
  readonly linksMissing: string[];
  readonly wordsMissing: string[];
  readonly anyMissing: boolean;
  readonly forbiddenHits: string[];
  readonly pass: boolean;
}

export function scoreAnswer(c: EvalCase, a: Answer): Verdict {
  const lower = a.text.toLowerCase();
  const languageOk = languageMatches(c.language, a.text);
  const linksMissing = (c.expectLinks ?? []).filter((p) => !linkPresent(a.links, p));
  const wordsMissing = (c.expectAll ?? []).filter((w) => !lower.includes(w.toLowerCase()));
  const anyMissing =
    (c.mustContainAny?.length ?? 0) > 0 &&
    !(c.mustContainAny ?? []).some((w) => lower.includes(w.toLowerCase()));
  const forbiddenHits = (c.forbidden ?? []).filter((w) => lower.includes(w.toLowerCase()));
  const pass =
    a.text.trim() !== '' &&
    languageOk &&
    linksMissing.length === 0 &&
    wordsMissing.length === 0 &&
    !anyMissing &&
    forbiddenHits.length === 0;
  return { languageOk, linksMissing, wordsMissing, anyMissing, forbiddenHits, pass };
}
