import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AssistantAudience } from '@skydrop/db';

export interface HelpHit {
  readonly title: string;
  readonly text: string;
  /** The Bangla half, when the source has one (i18n catalogues do). */
  readonly textBn?: string;
  readonly source: 'portal-text' | 'setting-guide' | 'internal-docs';
}

interface HelpEntry extends HelpHit {
  readonly haystack: string;
  readonly titleLower: string;
}

/**
 * WHERE each audience's help comes from. This table IS the access
 * boundary for `search_help`: an audience can only ever search the
 * sources listed against it, so a seller cannot reach staff text by any
 * query. Internal design docs (`docs/invariants`) and the settings guide
 * are STAFF-ONLY. `assistant-help-scoping.spec.ts` pins it.
 */
export const HELP_SOURCES: Readonly<
  Record<
    AssistantAudience,
    {
      readonly messageDirs: readonly string[];
      readonly settingGuide: boolean;
      readonly internalDocs: boolean;
    }
  >
> = {
  STAFF: { messageDirs: ['apps/admin/src/i18n/messages'], settingGuide: true, internalDocs: true },
  SELLER: {
    messageDirs: ['apps/seller/src/i18n/messages'],
    settingGuide: false,
    internalDocs: false,
  },
  STORE: {
    messageDirs: ['apps/reseller/src/i18n/messages'],
    settingGuide: false,
    internalDocs: false,
  },
  ASSOCIATE: {
    messageDirs: ['apps/associate/src/i18n/messages'],
    settingGuide: false,
    internalDocs: false,
  },
};

const SETTING_GUIDE_FILE = 'apps/admin/src/lib/system-setting-guide.ts';
const INTERNAL_DOCS_DIR = 'docs/invariants';
const MIN_TEXT = 40;
const CHUNK = 700;
const STOP = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'to',
  'of',
  'in',
  'on',
  'for',
  'and',
  'or',
  'how',
  'do',
  'i',
  'my',
  'what',
  'can',
  'me',
  'it',
  'this',
  'that',
  'with',
  'be',
  'you',
  'your',
  'does',
]);

/** Reads one quoted literal starting at `i` (after whitespace). Null if there is none. */
export function readStringLiteral(
  src: string,
  from: number,
): { value: string; end: number } | null {
  let i = from;
  while (i < src.length && /\s/.test(src[i] ?? '')) i++;
  const quote = src[i];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  i++;
  let out = '';
  while (i < src.length) {
    const ch = src[i] ?? '';
    if (ch === '\\') {
      const next = src[i + 1] ?? '';
      if (next === 'n') out += '\n';
      else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) {
        out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
        i += 4;
      } else out += next;
      i += 2;
      continue;
    }
    if (quote === '`' && ch === '$' && src[i + 1] === '{') return null;
    if (ch === quote) return { value: out, end: i + 1 };
    out += ch;
    i++;
  }
  return null;
}

/** `'key': ['english', 'bangla']` entries of a defineMessages() file. */
export function parseMessageFile(src: string): Array<{ key: string; en: string; bn: string }> {
  const out: Array<{ key: string; en: string; bn: string }> = [];
  const re = /'([A-Za-z0-9_.-]+)':\s*\[/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const en = readStringLiteral(src, re.lastIndex);
    if (en === null) continue;
    let j = en.end;
    while (j < src.length && /[\s,]/.test(src[j] ?? '')) j++;
    const bn = readStringLiteral(src, j);
    if (bn === null) continue;
    out.push({ key: m[1] ?? '', en: en.value, bn: bn.value });
  }
  return out;
}

/** `'setting.key': { name, what, example }` entries of the settings guide. */
export function parseSettingGuide(src: string): Array<{ key: string; text: string }> {
  const out: Array<{ key: string; text: string }> = [];
  const re = /^ {2}'([a-z0-9_.]+)': \{\n/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const end = src.indexOf('\n  },', re.lastIndex);
    if (end < 0) continue;
    const body = src.slice(re.lastIndex, end);
    const parts: string[] = [];
    for (const field of ['name', 'what', 'example']) {
      const at = body.search(new RegExp(`\\n? {4}${field}:`));
      if (at < 0) continue;
      const lit = readStringLiteral(body, body.indexOf(':', at) + 1);
      if (lit !== null) parts.push(lit.value);
    }
    if (parts.length > 0) out.push({ key: m[1] ?? '', text: parts.join(' — ') });
  }
  return out;
}

function chunkText(text: string): string[] {
  const pieces: string[] = [];
  for (const para of text.split(/\n{2,}/)) {
    const p = para.replace(/\s+/g, ' ').trim();
    if (p.length < MIN_TEXT) continue;
    if (p.length <= CHUNK) {
      pieces.push(p);
      continue;
    }
    let cur = '';
    for (const sentence of p.split(/(?<=[.!?])\s+/)) {
      if (cur.length + sentence.length > CHUNK && cur.length > 0) {
        pieces.push(cur);
        cur = '';
      }
      cur += (cur ? ' ' : '') + sentence;
    }
    if (cur.length >= MIN_TEXT) pieces.push(cur);
  }
  return pieces;
}

export function tokenize(q: string): string[] {
  return [...q.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)]
    .map((m) => m[0])
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/**
 * Keyword search over an AUDIENCE-SCOPED help index (phase A: built from
 * the portals' own message catalogues and, for staff only, the settings
 * guide and the internal docs). Built lazily from the repo checkout on
 * first use and cached per source; if the sources are not on disk (a
 * bundle without the monorepo) the index is empty and the tool says so —
 * it never falls back to a wider source.
 */
@Injectable()
export class AssistantHelpService {
  private readonly log = new Logger(AssistantHelpService.name);
  private readonly cache = new Map<string, readonly HelpEntry[]>();
  private root: string | null | undefined;

  /** Point the index at a different checkout (tests). Drops anything cached. */
  useRoot(root: string): this {
    this.root = root;
    this.cache.clear();
    return this;
  }

  search(audience: AssistantAudience, query: string, limit = 4): HelpHit[] {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];
    const scored: Array<{ e: HelpEntry; score: number }> = [];
    for (const e of this.indexFor(audience)) {
      let score = 0;
      for (const t of tokens) {
        if (e.haystack.includes(t)) score += 1;
        if (e.titleLower.includes(t)) score += 2;
      }
      // Every token matching beats most tokens matching.
      if (score > 0)
        scored.push({ e, score: score + (tokens.every((t) => e.haystack.includes(t)) ? 3 : 0) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ e }) => ({
      title: e.title,
      text: e.text.length > 600 ? `${e.text.slice(0, 600)}…` : e.text,
      ...(e.textBn === undefined ? {} : { textBn: e.textBn.slice(0, 600) }),
      source: e.source,
    }));
  }

  private findRoot(): string | null {
    if (this.root !== undefined) return this.root;
    let dir = resolve(__dirname);
    for (let i = 0; i < 10; i++) {
      if (existsSync(join(dir, 'apps', 'seller', 'src', 'i18n'))) {
        this.root = dir;
        return dir;
      }
      const up = resolve(dir, '..');
      if (up === dir) break;
      dir = up;
    }
    this.root = null;
    this.log.warn('help sources not found on disk; search_help will return nothing');
    return null;
  }

  private indexFor(audience: AssistantAudience): readonly HelpEntry[] {
    const cached = this.cache.get(audience);
    if (cached !== undefined) return cached;
    const entries: HelpEntry[] = [];
    const root = this.findRoot();
    const spec = HELP_SOURCES[audience];
    if (root !== null) {
      for (const rel of spec.messageDirs) entries.push(...this.messageEntries(join(root, rel)));
      if (spec.settingGuide) entries.push(...this.guideEntries(join(root, SETTING_GUIDE_FILE)));
      if (spec.internalDocs) entries.push(...this.docEntries(join(root, INTERNAL_DOCS_DIR)));
    }
    this.cache.set(audience, entries);
    return entries;
  }

  private entry(
    title: string,
    text: string,
    source: HelpHit['source'],
    textBn?: string,
  ): HelpEntry {
    return {
      title,
      text,
      source,
      ...(textBn === undefined ? {} : { textBn }),
      haystack: `${title} ${text}`.toLowerCase(),
      titleLower: title.toLowerCase(),
    };
  }

  private messageEntries(dir: string): HelpEntry[] {
    if (!existsSync(dir)) return [];
    const out: HelpEntry[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts')) continue;
      for (const m of parseMessageFile(readFileSync(join(dir, f), 'utf8'))) {
        // Short strings are button and column labels, not help.
        if (m.en.length < MIN_TEXT) continue;
        out.push(this.entry(m.key, m.en, 'portal-text', m.bn));
      }
    }
    return out;
  }

  private guideEntries(file: string): HelpEntry[] {
    if (!existsSync(file)) return [];
    return parseSettingGuide(readFileSync(file, 'utf8')).map((g) =>
      this.entry(g.key, g.text, 'setting-guide'),
    );
  }

  private docEntries(dir: string): HelpEntry[] {
    if (!existsSync(dir)) return [];
    const out: HelpEntry[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      for (const c of chunkText(readFileSync(join(dir, f), 'utf8'))) {
        out.push(this.entry(f.replace(/\.md$/, ''), c, 'internal-docs'));
      }
    }
    return out;
  }
}
