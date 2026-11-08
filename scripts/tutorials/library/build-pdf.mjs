/**
 * Build the interactive tutorial-library PDF.
 *
 *   node scripts/tutorials/library/build-pdf.mjs
 *   node scripts/tutorials/library/build-pdf.mjs --library=fixture/library.json --out=/tmp/x.pdf
 *
 * Inputs are the two files in `SCHEMA.md`: `library.json` (what exists) and
 * `drive-links.json` (where the videos live). They are joined here, never
 * merged on disk, so a re-upload does not regenerate the library and a
 * missing link can be told from a wrong one — absent renders as a quiet
 * "not uploaded yet", never as a dead or guessed href.
 *
 * WHY HTML → CHROMIUM RATHER THAN A PDF LIBRARY. The whole point of the
 * document is that it is clickable: an `<a href>` comes out of `page.pdf()`
 * as a real PDF link annotation (`/Subtype /Link`), external ones as `/URI`
 * and in-document ones as `/GoTo`. Drawing the same page with a PDF drawing
 * API would mean hand-placing every annotation rectangle. Chromium also
 * gives us the outline for free: `page.pdf({ outline: true })` turns the
 * h1–h4 structure into PDF bookmarks, which is the sidebar a reader
 * navigates with. There is a linked table of contents as well, because a
 * phone PDF viewer often hides the bookmark pane.
 *
 * NO NETWORK AT RENDER TIME. The CSS is inlined in the document and the
 * type is a system stack — no webfont, no CDN, nothing to fail offline.
 *
 * The reader is a new staff member or client in their first week, usually on
 * a phone, who wants the one video that answers their question and then the
 * page to go and do the thing. Everything here is sorted for FINDING.
 *
 * READER WORDS, NOT CODE WORDS: "Client", "Member store", "Associate".
 * `seller` / `reseller` never reach the page — see `sanitiseConsoleName`.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ────────────────────────────── arguments ────────────────────────────── */

function parseArgs(argv) {
  const out = {
    library: path.join(HERE, 'library.json'),
    links: path.join(HERE, 'drive-links.json'),
    out: path.join(HERE, 'Skydrop-tutorials.pdf'),
    html: null,
  };
  for (const arg of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'library') out.library = path.resolve(value);
    else if (key === 'links') out.links = path.resolve(value);
    else if (key === 'out') out.out = path.resolve(value);
    else if (key === 'html') out.html = path.resolve(value);
  }
  return out;
}

/* ───────────────────────────── reader words ──────────────────────────── */

/**
 * The UI word differs from the code word on purpose (see CLAUDE.md). The
 * library is derived from code, so a generator slip could put "seller" in
 * front of a reader; this is the last gate before it does.
 */
const CONSOLE_LABEL = {
  client: 'Client',
  seller: 'Client',
  member: 'Member store',
  reseller: 'Member store',
  associate: 'Associate',
  admin: 'Admin',
  track: 'Tracking',
  marketing: 'Marketing site',
};

/**
 * Section order, set by Talha on 2026-11-08: admin, client, associate,
 * member. Four sections, one per console, each self-contained — the index
 * leads to a section and the section holds everything about it.
 */
const CONSOLE_ORDER = ['admin', 'client', 'associate', 'member', 'track', 'marketing'];

const CODE_WORDS = [
  [/\bresellers\b/gi, 'member stores'],
  [/\breseller\b/gi, 'member store'],
  [/\bsellers\b/gi, 'clients'],
  [/\bseller\b/gi, 'client'],
];

/**
 * Every string a READER sees goes through this — console names, tutorial
 * titles and summaries, step labels, page titles, section headings. Not
 * routes, not hosts, not anchors: a URL is literal and rewriting it would
 * break the link, which is the one thing this document exists to get right.
 * Capitalisation of the first letter is preserved.
 */
function readerWords(text) {
  let out = String(text ?? '');
  for (const [pattern, replacement] of CODE_WORDS) {
    out = out.replace(pattern, (hit) =>
      hit[0] === hit[0].toUpperCase() ? titleCase(replacement) : replacement,
    );
  }
  return out;
}

function sanitiseConsoleName(text, key) {
  if (!text) return CONSOLE_LABEL[key] ?? titleCase(key ?? 'Console');
  return readerWords(text);
}

const LANGUAGE_LABEL = {
  en: 'English',
  bn: 'Bangla',
  hi: 'Hindi',
};

/* No Bengali or Devanagari face is guaranteed on the render host, and a
   missing glyph prints as a box, so language names stay in Latin. */
function languageLabel(code) {
  return LANGUAGE_LABEL[code] ?? String(code ?? '').toUpperCase();
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function titleCase(text) {
  const s = String(text ?? '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Only http(s) is a link. Anything else is treated as absent, never guessed. */
function safeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function duration(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  const total = Math.round(n);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} m`;
  if (m > 0) return `${m} m ${String(s).padStart(2, '0')} s`;
  return `${s} s`;
}

function formatDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  const when = Number.isNaN(d.getTime()) ? new Date() : d;
  return when.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * A route with a dynamic segment — `/orders/[id]`, `/orders/:id` — is a
 * PATTERN, not an address. Typing it into a browser lands on nothing, so it
 * is printed as the pattern it is and never dressed up as a link. Same rule
 * as the missing Drive link: absent beats wrong.
 */
function isRoutePattern(routePath) {
  return /\[|\]|:\w|\*/.test(String(routePath ?? ''));
}

/** `https://admin.skydrop.global/orders/` → `admin.skydrop.global/orders`. */
function hostLabel(url) {
  return String(url ?? '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
}

function joinUrl(host, routePath) {
  if (isRoutePattern(routePath)) return null;
  const base = String(host ?? '').replace(/\/+$/, '');
  const route = String(routePath ?? '');
  if (!base) return null;
  return safeUrl(`${base}${route.startsWith('/') ? route : `/${route}`}`);
}

const anchors = {
  /** The console's own SECTION — what the index jumps to. */
  section: (key) => `sec-${slugify(key)}`,
  /** Its contents list inside the index. */
  indexConsole: (key) => `idx-${slugify(key)}`,
  tutorial: (slug) => `t-${slugify(slug)}`,
};

/* ──────────────────────────── the step groups ────────────────────────── */

/**
 * The long admin video is 302 steps. A flat 302-item list is not something a
 * person reads, so the steps get grouped under headings.
 *
 * Three input shapes are accepted, because the generator is a sibling script
 * and the contract only promises `string[]`:
 *
 *   1. `[{ section, steps: [...] }]`  — already grouped. Used as-is.
 *   2. `[{ section, title }]`         — per-step section. Grouped on it.
 *   3. `['Dashboard', ...]`           — flat. Grouped by the heuristic below,
 *                                      and only when the list is long enough
 *                                      to need it.
 *
 * The heuristic reads the prefix the recording scripts already carry — a
 * step id like `dash-callcentre` or a heading like `Money — the bank book`
 * — and accepts the grouping only when it actually partitions the list
 * (enough groups, and no single group swallowing most of it). Otherwise it
 * falls back to honest fixed ranges, which is better than a wrong heading.
 */
const GROUP_THRESHOLD = 40;
const CHUNK = 25;

function looksLikeId(text) {
  return /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(text);
}

/* Words the operation says out loud as letters. Title-casing a step id
   would otherwise print "Rto bench" and "Courier ndr". */
const ACRONYMS = /\b(rto|cod|ndr|awb|sku|otp|fx|csv|pnl|p-l|wms|api|id)\b/gi;

function restoreAcronyms(text) {
  return text.replace(ACRONYMS, (word) =>
    word.toLowerCase() === 'pnl' ? 'P&L' : word.toUpperCase(),
  );
}

function humaniseStep(text) {
  if (!looksLikeId(text)) return readerWords(text);
  return readerWords(restoreAcronyms(titleCase(text.replace(/[-_]+/g, ' '))));
}

function prefixOf(text) {
  const em = /^(.{2,40}?)\s*(?:—|–|:|\/|\||>)\s+/u.exec(text);
  if (em) return em[1].trim();
  if (looksLikeId(text)) {
    const first = text.split(/[-_]/)[0];
    return first.length >= 2 ? readerWords(restoreAcronyms(titleCase(first))) : null;
  }
  return null;
}

function acceptGrouping(groups, total) {
  if (groups.length < 3 || groups.length > 60) return false;
  const biggest = Math.max(...groups.map((g) => g.steps.length));
  return biggest <= Math.max(CHUNK, total * 0.6);
}

function groupByKey(items, keyOf) {
  const groups = [];
  const byKey = new Map();
  for (const item of items) {
    const key = keyOf(item);
    let group = byKey.get(key);
    if (!group) {
      group = { section: key, steps: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.steps.push(item.label);
  }
  return groups;
}

function normaliseSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return { total: 0, groups: [] };

  // Shape 1: already grouped.
  if (steps.every((s) => s && typeof s === 'object' && Array.isArray(s.steps))) {
    const groups = steps.map((s) => ({
      section: readerWords(s.section ?? s.title ?? s.name ?? 'Steps'),
      steps: s.steps.map((x) => humaniseStep(String(typeof x === 'object' ? labelOf(x) : x))),
    }));
    return { total: groups.reduce((n, g) => n + g.steps.length, 0), groups };
  }

  /* `raw` is kept alongside `label`: the prefix heuristic has to read the
     step as the recording script wrote it (`dash-callcentre`), and
     humanising first destroys exactly the token it keys on. */
  const items = steps.map((s) => {
    const raw = s && typeof s === 'object' ? labelOf(s) : String(s);
    return {
      raw,
      label: humaniseStep(raw),
      section: s && typeof s === 'object' ? (s.section ?? s.group ?? null) : null,
    };
  });
  const total = items.length;

  // Shape 2: per-step section.
  if (items.some((i) => i.section)) {
    const groups = groupByKey(items, (i) => readerWords(i.section ?? 'Other steps'));
    return { total, groups };
  }

  // Shape 3: flat. Short lists stay flat — a heading per five steps is noise.
  if (total <= GROUP_THRESHOLD)
    return { total, groups: [{ section: null, steps: items.map((i) => i.label) }] };

  const prefixed = items.map((i) => ({ ...i, key: prefixOf(i.raw) }));
  if (prefixed.every((i) => i.key)) {
    const groups = groupByKey(prefixed, (i) => i.key);
    if (acceptGrouping(groups, total)) return { total, groups };
  }

  const groups = [];
  for (let i = 0; i < total; i += CHUNK) {
    groups.push({
      section: `Steps ${i + 1}–${Math.min(i + CHUNK, total)}`,
      steps: items.slice(i, i + CHUNK).map((x) => x.label),
    });
  }
  return { total, groups };
}

function labelOf(step) {
  return String(step.title ?? step.label ?? step.step ?? step.text ?? step.id ?? '');
}

/* ───────────────────────────────── CSS ───────────────────────────────── */

/*
  Print-first, and taken from `.claude/skills/skydrop-design` — the light
  theme only, because paper has one theme. Page `#faf9f7` (the warm
  off-white, not blue-tinted), card `#ffffff`, raised `#f0eeea`, the primary
  at `hsl(212 72% 36%) #1a579e`, saffron `#a8730f` only as a small
  supporting accent, success `#116a31`, and the neutral status tones for
  secondary text. Nothing relies on hover: every affordance is visible ink.
*/
const CSS = `
:root {
  --surface: #faf9f7;
  --surface-2: #ffffff;
  --surface-3: #f0eeea;
  --line: #e2e8f0;
  --line-strong: #cfd7e2;
  --primary: #1a579e;
  --primary-deep: #15467f;
  --saffron: #a8730f;
  --success: #116a31;
  --ink: #131b24;
  --ink-muted: #4e5e70;
  --ink-quiet: #586777;
}
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0;
  background: var(--surface);
  color: var(--ink);
  font-family: 'Liberation Sans', 'DejaVu Sans', 'Helvetica Neue', Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.5;
}
a { color: var(--primary); text-decoration: none; }
a.plain { color: inherit; }
code, .mono { font-family: 'DejaVu Sans Mono', 'Liberation Mono', monospace; }

h1, h2, h3, h4 { margin: 0; line-height: 1.25; break-after: avoid; }
h1 {
  font-size: 20pt; font-weight: 600; letter-spacing: -0.015em;
  padding-bottom: 6pt; margin-bottom: 12pt;
  border-bottom: 2px solid var(--primary);
}
h2 {
  font-size: 13.5pt; font-weight: 600; margin: 16pt 0 7pt;
  color: var(--primary-deep);
}
h3 { font-size: 11.5pt; font-weight: 600; margin: 12pt 0 4pt; }
h4 {
  font-size: 9.5pt; font-weight: 600; margin: 9pt 0 3pt;
  text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-muted);
}
p { margin: 0 0 7pt; max-width: 65ch; }
.sheet { break-after: page; }
.sheet:last-child { break-after: auto; }

/* ── cover ───────────────────────────────────────────────────────────── */
.cover { padding-top: 24mm; }
.mark {
  display: inline-block; font-size: 10pt; font-weight: 600;
  letter-spacing: 0.22em; text-transform: uppercase; color: var(--primary);
  border: 1px solid var(--primary); border-radius: 999px; padding: 3pt 10pt;
}
.cover h1 {
  font-size: 34pt; font-weight: 600; letter-spacing: -0.025em;
  border: 0; margin: 14pt 0 6pt; padding: 0;
}
.cover .lede { font-size: 12.5pt; color: var(--ink-muted); max-width: 54ch; }
.cover .meta {
  margin-top: 18mm; border-top: 1px solid var(--line-strong);
  padding-top: 8pt; font-size: 9.5pt; color: var(--ink-muted);
  display: flex; flex-wrap: wrap; gap: 4pt 18pt;
}
.cover .meta b { color: var(--ink); font-weight: 600; }

/* ── how to use ──────────────────────────────────────────────────────── */
.howto {
  background: var(--surface-2); border: 1px solid var(--line);
  border-left: 3px solid var(--saffron);
  border-radius: 12pt; padding: 10pt 12pt; margin: 0 0 14pt;
}
.howto h2 { margin: 0 0 5pt; color: var(--ink); font-size: 11.5pt; }
.howto ol { margin: 0; padding-left: 16pt; }
.howto li { margin: 0 0 2pt; max-width: 72ch; }

/* ── tables ──────────────────────────────────────────────────────────── */
.consoleHead {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 4pt 10pt;
  margin: 16pt 0 6pt; break-after: avoid;
}
.consoleHead h2 { margin: 0; }
.consoleHead .who { font-size: 9pt; color: var(--ink-muted); }
.consoleHead .host { font-size: 9pt; }

table { width: 100%; border-collapse: collapse; margin: 0 0 6pt; }
thead { display: table-header-group; }
th {
  text-align: left; font-size: 8pt; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.07em; color: var(--ink-muted);
  padding: 4pt 6pt; border-bottom: 1px solid var(--line-strong);
}
td { padding: 5pt 6pt; border-bottom: 1px solid var(--line); vertical-align: top; font-size: 9.5pt; }
tr { break-inside: avoid; }
tbody tr:nth-child(even) td { background: var(--surface-3); }
td.n { width: 22pt; color: var(--ink-muted); font-variant-numeric: tabular-nums; }
td.dur { width: 56pt; white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--ink-muted); }
td.watch { width: 108pt; }
.rowTitle { font-weight: 600; }
.rowSummary { display: block; color: var(--ink-muted); font-size: 8.5pt; margin-top: 1pt; max-width: 62ch; }
.sectionRow td {
  background: var(--surface-3) !important; font-size: 8pt; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.07em; color: var(--ink-muted);
  border-bottom: 1px solid var(--line-strong);
}

/* ── watch links & pills ─────────────────────────────────────────────── */
.watchList { display: block; }
.watchList > span, .watchList > a { display: block; white-space: nowrap; }
.watch-link { font-weight: 600; }
.watch-link::before { content: '▸ '; color: var(--primary); }
.langs { display: block; font-size: 8pt; color: var(--ink-muted); white-space: nowrap; }
.absent { color: var(--ink-quiet); font-size: 8.5pt; }
.absent::before { content: '· '; }
.pill {
  display: inline-block; font-size: 7.5pt; font-weight: 600; border-radius: 999px;
  padding: 1pt 6pt; border: 1px solid var(--line-strong); color: var(--ink-muted);
  white-space: nowrap;
}
.pill.long { border-color: var(--primary); color: var(--primary); }
.pill.unfilmed { border-color: var(--line-strong); color: var(--ink-quiet); }

/* ── tutorial entries ────────────────────────────────────────────────── */
.tut {
  background: var(--surface-2); border: 1px solid var(--line); border-radius: 12pt;
  padding: 9pt 11pt; margin: 0 0 9pt; break-inside: avoid;
}
.tut.big { break-inside: auto; }
.tut h3 { margin: 0; }
.tutHead { display: flex; align-items: baseline; gap: 6pt; margin: 0 0 2pt; break-after: avoid; }
.tut .sub { font-size: 8.5pt; color: var(--ink-muted); margin: 0 0 5pt; }
.tut .sub b { color: var(--ink); font-weight: 600; }
.tut .summary { margin: 0 0 6pt; font-size: 9.5pt; }
.teaches { font-size: 8.5pt; margin: 0 0 6pt; }
.teaches .lbl { color: var(--ink-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; font-size: 7.5pt; }
/* Only a group that can actually fit on a page asks not to be split:
   break-inside avoid on a group taller than a page is an instruction the
   renderer has to disobey, and what it does then is its own business. */
.stepGroup { margin-top: 7pt; }
.stepGroup.tight { break-inside: avoid; }
ol.steps { margin: 0; padding-left: 18pt; columns: 2; column-gap: 16pt; }
ol.steps.single { columns: 1; }
ol.steps li { font-size: 8.5pt; margin: 0 0 1pt; break-inside: avoid; }
.backlink { font-size: 8pt; }

/* ── the four section tiles on the index ─────────────────────────────── */
.tiles {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8pt;
  margin: 0 0 16pt; break-inside: avoid;
}
.tile {
  display: block; background: var(--surface-2); border: 1px solid var(--line);
  border-left: 3px solid var(--primary); border-radius: 12pt;
  padding: 9pt 11pt; color: inherit; break-inside: avoid;
}
.tile .n {
  font-size: 8pt; font-weight: 600; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--primary);
  font-variant-numeric: tabular-nums;
}
.tile .nm { display: block; font-size: 13pt; font-weight: 600; margin: 1pt 0 2pt; }
.tile .wh { display: block; font-size: 8.5pt; color: var(--ink-muted); }
.tile .ct { display: block; font-size: 8.5pt; color: var(--ink-muted); margin-top: 3pt; }
.tile .ct b { color: var(--ink); }

/* ── the page addresses a tutorial is filmed on ──────────────────────── */
.pageUrls { margin: 7pt 0 0; font-size: 8.5pt; break-inside: avoid; }
.pageUrls .lbl {
  display: block; color: var(--ink-muted); font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.06em; font-size: 7.5pt;
  margin-bottom: 2pt;
}
.pageUrls ul { margin: 0; padding-left: 14pt; columns: 2; column-gap: 16pt; }
.pageUrls ul.single { columns: 1; }
.pageUrls li { margin: 0 0 1pt; break-inside: avoid; }
.pageUrls li a, .pageUrls li .urlPath { word-break: break-all; }
.pageUrls li .ttl { color: var(--ink); }
.urlPath { font-family: 'DejaVu Sans Mono', 'Liberation Mono', monospace; font-size: 8pt; }
.note { font-size: 8.5pt; color: var(--ink-muted); max-width: 70ch; }
.empty { font-size: 9pt; color: var(--ink-quiet); font-style: italic; }
`;

/* ─────────────────────────────── rendering ───────────────────────────── */

function watchCell(tutorial, links) {
  const languages = Array.isArray(tutorial.languages) ? tutorial.languages : [];
  if (languages.length === 0) {
    return '<span class="absent">not filmed yet</span>';
  }
  const parts = languages.map((lang) => {
    const url = safeUrl(links?.[tutorial.slug]?.[lang]);
    const label = esc(languageLabel(lang));
    // A missing link is ABSENT, not broken: the row still says the take
    // exists and in which language, and nothing is guessed.
    return url
      ? `<a class="watch-link" href="${esc(url)}">Watch on Google Drive · ${label}</a>`
      : `<span class="absent">${label} — not uploaded yet</span>`;
  });
  return `<span class="watchList">${parts.join('')}</span>`;
}

/**
 * The index's Watch cell goes to the tutorial's ENTRY, not to Drive
 * (Talha, 2026-11-08). The index is a table of contents: tapping a row
 * should land you on the page that tells you what the video covers and
 * which screens it is filmed on, and the Drive link is one tap further,
 * on that entry. Jumping straight out of the document to a 90-minute
 * recording skips the page that exists to tell you whether to.
 */
function indexWatchCell(tutorial) {
  const languages = Array.isArray(tutorial.languages) ? tutorial.languages : [];
  if (languages.length === 0) return '<span class="absent">not filmed yet</span>';
  return `<span class="watchList"><a class="watch-link" href="#${anchors.tutorial(tutorial.slug)}">Watch</a><span class="langs">${languages
    .map((l) => esc(languageLabel(l)))
    .join(' · ')}</span></span>`;
}

function kindPill(kind) {
  if (!kind || kind === 'short') return '';
  const cls = kind === 'long' ? 'pill long' : 'pill';
  return ` <span class="${cls}">${esc(kind)}</span>`;
}

/**
 * The real scene list for a LONG video.
 *
 * `library.json` stores a long video's `steps` as its nine chapter
 * headings, which is the right summary for an index and the wrong thing
 * for a document whose job is "step by step": the admin walkthrough is
 * 302 scenes and the headings hide all of them. So the chapters are read
 * back out of the recording module itself — the `X_SAY` arrays in the
 * order `narration.steps` composes them, and the `id` of every scene
 * inside each — and handed to `normaliseSteps` in its already-grouped
 * shape. Parsed rather than imported because the module pulls in the
 * Playwright flow helpers, and this script renders a PDF.
 *
 * Returns null when anything does not line up, and the caller keeps the
 * headings. A wrong step list is worse than a short one.
 */
function longChapters(slug) {
  const file = path.join(HERE, '..', 'long', `${slug.replace(/-everything$/, '')}.mjs`);
  let src;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }

  /* The letters, in the order `narration.steps` spreads them. */
  const composed = /narration\s*=\s*\{[\s\S]*?steps:\s*\[([^\]]*?)\]/.exec(src);
  if (composed === null) return null;
  const letters = [...composed[1].matchAll(/\.\.\.([A-Z])_SAY/g)].map((m) => m[1]);
  if (letters.length === 0) return null;

  /* The module docblock's own spine: "  H  the desk       dashboard, ..." */
  const spine = new Map(
    [...src.matchAll(/^\s*\*\s{2,}([A-Z])\s{2,}(\S[^\n]*?)\s{2,}\S/gm)].map((m) => [
      m[1],
      String(m[2]).replace(/\s+/g, ' ').trim(),
    ]),
  );

  const groups = [];
  for (const letter of letters) {
    const block = new RegExp(`^const ${letter}_SAY = \\[([\\s\\S]*?)^\\];`, 'm').exec(src);
    if (block === null) return null;
    /* Raw ids: `normaliseSteps` humanises them itself, and doing it twice
       is how "RTO bench" becomes "Rto Bench". */
    const steps = [...block[1].matchAll(/^\s{4}id:\s*'([^']+)'/gm)].map((m) => m[1]);
    if (steps.length === 0) return null;
    const heading = spine.get(letter);
    groups.push({ section: heading ? `${letter} — ${titleCase(heading)}` : letter, steps });
  }
  return groups;
}

function buildHtml(library, driveLinks) {
  const links = driveLinks?.videos ?? {};
  const folder = safeUrl(driveLinks?.folder);

  const consoles = (Array.isArray(library.consoles) ? library.consoles : [])
    .map((c) => ({
      ...c,
      key: String(c.key ?? ''),
      name: sanitiseConsoleName(c.name, c.key),
      who: sanitiseConsoleName(c.who, c.key),
      pages: (Array.isArray(c.pages) ? c.pages : []).map((p) => ({
        ...p,
        title: readerWords(p.title ?? p.path),
        section: p.section ? readerWords(p.section) : null,
      })),
    }))
    .sort((a, b) => {
      const ai = CONSOLE_ORDER.indexOf(a.key);
      const bi = CONSOLE_ORDER.indexOf(b.key);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.name.localeCompare(b.name);
    });

  const byKey = new Map(consoles.map((c) => [c.key, c]));
  const tutorials = (Array.isArray(library.tutorials) ? library.tutorials : []).map((t) => ({
    ...t,
    slug: String(t.slug ?? slugify(t.title)),
    title: readerWords(t.title),
    summary: t.summary ? readerWords(t.summary) : '',
    section: t.section ? readerWords(t.section) : null,
    languages: Array.isArray(t.languages) ? t.languages : [],
    teaches: Array.isArray(t.teaches) ? t.teaches : [],
    stepGroups: normaliseSteps(
      (t.kind === 'long' ? longChapters(String(t.slug ?? '')) : null) ?? t.steps,
    ),
  }));

  const tutorialsByConsole = new Map();
  for (const key of consoles.map((c) => c.key)) tutorialsByConsole.set(key, []);
  const orphans = [];
  for (const t of tutorials) {
    const list = tutorialsByConsole.get(String(t.console));
    if (list) list.push(t);
    else orphans.push(t);
  }
  if (orphans.length) {
    tutorialsByConsole.set('__other', orphans);
    consoles.push({ key: '__other', name: 'Other', host: '', who: '', pages: [] });
  }
  for (const list of tutorialsByConsole.values()) {
    list.sort(
      (a, b) =>
        String(a.section ?? '').localeCompare(String(b.section ?? '')) ||
        Number(a.order ?? 0) - Number(b.order ?? 0) ||
        a.title.localeCompare(b.title),
    );
  }

  const totals = {
    tutorials: tutorials.length,
    filmed: tutorials.filter((t) => t.languages.length > 0).length,
    linked: tutorials.filter((t) => t.languages.some((l) => safeUrl(links?.[t.slug]?.[l]))).length,
    /* Addresses this document actually links to, not every route the app
       has: the page directory is gone, so claiming the old number would
       be claiming a list that is no longer in here. */
    pages: new Set(tutorials.flatMap((t) => t.teaches.map((r) => `${t.console}|${r}`))).size,
    consoles: consoles.filter((c) => c.key !== '__other').length,
  };

  const out = [];

  /* ── 1. cover ─────────────────────────────────────────────────────── */
  out.push(`<section class="sheet cover">
  <span class="mark">Skydrop</span>
  <h1>The tutorial library</h1>
  <p class="lede">Four sections, one per console. Every tutorial has its steps, its recording
  on Google&nbsp;Drive and the address of every page it is filmed on, together in one entry.</p>
  <p class="lede" style="font-size:10.5pt">This document is interactive. The index leads to a
  section; <b>Watch</b> opens the video; every page address is a live link into the console.</p>
  <div class="meta">
    <span><b>${totals.tutorials}</b> tutorials</span>
    <span><b>${totals.filmed}</b> filmed</span>
    <span><b>${totals.linked}</b> with a video link</span>
    <span><b>${totals.pages}</b> page addresses across <b>${totals.consoles}</b> consoles</span>
    <span>Generated <b>${esc(formatDate(library.generatedAt))}</b></span>
    ${folder ? `<span><a href="${esc(folder)}">Open the whole video folder</a></span>` : ''}
  </div>
</section>`);

  /* ── 2. the index ─────────────────────────────────────────────────────
     Four sections, and under the tiles the full contents of each. The
     tile is for "I am an associate, take me to my part"; the list under
     it is for "I know the task, take me to that one video". Both land
     inside this document — nothing here is a second copy of a tutorial,
     which is what made the first draft of this PDF unreadable. */
  out.push('<section class="sheet">');
  out.push('<h1 id="index">Index</h1>');
  out.push(`<div class="howto">
  <h2>How to use this</h2>
  <ol>
    <li><b>Pick your console below.</b> Four sections, one per sign-in. Tap the tile to jump to it.</li>
    <li><b>Tap a tutorial's title or its <b>Watch</b> in the lists below</b> and you land on that tutorial's own entry: what it covers step by step, the address of every page it is filmed on, and a second <b>Watch on Google&nbsp;Drive</b> that opens the recording itself.</li>
    <li><b>Tap any address to open that screen</b> in the real console. You will need to be signed in.</li>
  </ol>
</div>`);

  out.push('<div class="tiles">');
  consoles.forEach((console_, i) => {
    const list = tutorialsByConsole.get(console_.key) ?? [];
    if (list.length === 0) return;
    const seconds = list.reduce((n, t) => n + (Number(t.durationSeconds) || 0), 0);
    const watchable = duration(seconds);
    out.push(`<a class="tile" href="#${anchors.section(console_.key)}">
  <span class="n">Section ${i + 1}</span>
  <span class="nm">${esc(console_.name)}</span>
  ${console_.who ? `<span class="wh">${esc(console_.who)}</span>` : ''}
  <span class="ct"><b>${list.length}</b> tutorials${watchable ? ` &nbsp;·&nbsp; <b>${esc(watchable)}</b> of video` : ''}</span>
</a>`);
  });
  out.push('</div>');

  for (const console_ of consoles) {
    const list = tutorialsByConsole.get(console_.key) ?? [];
    if (list.length === 0) continue;
    const host = safeUrl(console_.host);
    out.push(`<div class="consoleHead" id="${anchors.indexConsole(console_.key)}">
  <h2><a class="plain" href="#${anchors.section(console_.key)}">${esc(console_.name)}</a></h2>
  ${host ? `<span class="host"><a href="${esc(host)}">${esc(hostLabel(host))}</a></span>` : ''}
  ${console_.who ? `<span class="who">${esc(console_.who)}</span>` : ''}
</div>`);
    out.push(
      '<table><thead><tr><th>Tutorial</th><th>Length</th><th>Watch</th></tr></thead><tbody>',
    );
    let currentSection = Symbol('none');
    for (const t of list) {
      const section = t.section ?? null;
      if (section !== currentSection) {
        currentSection = section;
        if (section) out.push(`<tr class="sectionRow"><td colspan="3">${esc(section)}</td></tr>`);
      }
      const dur = duration(t.durationSeconds);
      out.push(`<tr>
  <td><a class="plain rowTitle" href="#${anchors.tutorial(t.slug)}">${esc(t.title)}</a>${kindPill(t.kind)}</td>
  <td class="dur">${dur ? esc(dur) : '—'}</td>
  <td class="watch">${indexWatchCell(t)}</td>
</tr>`);
    }
    out.push('</tbody></table>');
  }
  out.push('</section>');

  /* ── 3. one section per console ───────────────────────────────────────
     Everything about a tutorial in one place: the steps, the video link
     and the page addresses. The first draft of this document put those
     three in three different chapters, so reading one tutorial meant
     holding three page numbers in your head. */
  consoles.forEach((console_, i) => {
    const list = tutorialsByConsole.get(console_.key) ?? [];
    if (list.length === 0) return;
    const host = safeUrl(console_.host);
    out.push('<section class="sheet">');
    out.push(`<h1 id="${anchors.section(console_.key)}">${i + 1}. ${esc(console_.name)}</h1>`);
    const head = [];
    if (console_.who) head.push(esc(console_.who));
    if (host) head.push(`Sign in at <a href="${esc(host)}">${esc(hostLabel(host))}</a>`);
    head.push(`<a href="#index">Back to the index</a>`);
    out.push(`<p class="note">${head.join(' &nbsp;·&nbsp; ')}</p>`);

    let currentSection = Symbol('none');
    for (const t of list) {
      const section = t.section ?? null;
      if (section !== currentSection) {
        currentSection = section;
        if (section) out.push(`<h2>${esc(section)}</h2>`);
      }

      const dur = duration(t.durationSeconds);
      const big = t.stepGroups.total > GROUP_THRESHOLD;
      out.push(`<div class="tut${big ? ' big' : ''}" id="${anchors.tutorial(t.slug)}">`);
      /* The pill sits OUTSIDE the h3: Chromium builds each bookmark from
         the heading's text content, and a pill inside it reads as
         "Running the Skydrop operations desk long" in the sidebar. */
      out.push(`<div class="tutHead"><h3>${esc(t.title)}</h3>${kindPill(t.kind)}</div>`);
      const bits = [];
      if (dur) bits.push(`<b>${esc(dur)}</b>`);
      if (t.stepGroups.total) bits.push(`${t.stepGroups.total} steps`);
      bits.push(
        t.languages.length
          ? t.languages.map((l) => esc(languageLabel(l))).join(' · ')
          : 'not filmed yet',
      );
      out.push(`<p class="sub">${bits.join(' &nbsp;·&nbsp; ')}</p>`);
      if (t.summary) out.push(`<p class="summary">${esc(t.summary)}</p>`);
      out.push(`<p class="sub">${watchCell(t, links)}</p>`);

      if (t.stepGroups.total === 0) {
        out.push('<p class="empty">No step list recorded for this tutorial yet.</p>');
      } else {
        /* One running number across the whole tutorial: the groups are a
           way of reading the list, not a restart of it. "Step 143" has to
           mean the same thing here as it does in the video. */
        let stepNumber = 1;
        for (const group of t.stepGroups.groups) {
          out.push(`<div class="stepGroup${group.steps.length <= 30 ? ' tight' : ''}">`);
          if (group.section) out.push(`<h4>${esc(group.section)}</h4>`);
          const single = group.steps.length <= 6;
          out.push(`<ol class="steps${single ? ' single' : ''}" start="${stepNumber}">`);
          stepNumber += group.steps.length;
          for (const step of group.steps) out.push(`<li>${esc(step)}</li>`);
          out.push('</ol></div>');
        }
      }

      /* The pages this tutorial is filmed on, as real addresses rather
         than a pointer into a directory at the back. A route with a
         dynamic segment is printed as the pattern it is — typing
         `/orders/[id]` into a browser lands on nothing. */
      if (t.teaches.length > 0) {
        const pages = byKey.get(String(t.console))?.pages ?? [];
        const rows = t.teaches.map((route) => {
          const page = pages.find((p) => p.path === route);
          const title = page?.title ?? null;
          const url = joinUrl(console_.host, route);
          const label = title && title !== route ? `<span class="ttl">${esc(title)}</span> — ` : '';
          return url
            ? `<li>${label}<a href="${esc(url)}">${esc(hostLabel(url))}</a></li>`
            : `<li>${label}<span class="urlPath">${esc(route)}</span>` +
                (isRoutePattern(route)
                  ? ' <span class="absent">opened from its list, not by address</span>'
                  : '') +
                '</li>';
        });
        out.push(`<div class="pageUrls">
  <span class="lbl">Pages shown in this tutorial — tap to open</span>
  <ul${rows.length <= 4 ? ' class="single"' : ''}>${rows.join('')}</ul>
</div>`);
      }

      out.push('</div>');
    }
    out.push(`<p class="backlink"><a href="#index">Back to the index</a></p>`);
    out.push('</section>');
  });

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Skydrop — the tutorial library</title>
<style>${CSS}</style>
</head><body>
${out.join('\n')}
</body></html>`;
}

/* ───────────────────────── verify the rendered PDF ───────────────────── */

/**
 * Proof, not hope. Re-reads the bytes we just wrote and counts what a reader
 * would be able to tap: `/Subtype /Link` annotations split into `/URI`
 * (external) and `/GoTo`-style (in-document), the page count, and whether
 * an outline was written. Chromium emits annotations as plain objects, but
 * compressed object streams are decoded too so the count cannot silently
 * read zero and be reported as "no links needed".
 */
function inspectPdf(file) {
  const raw = fs.readFileSync(file);
  const chunks = [raw];
  const text0 = raw.toString('latin1');
  const streamRe = /\/Filter\s*\/FlateDecode[^>]*>>\s*stream\r?\n/g;
  let m;
  while ((m = streamRe.exec(text0))) {
    const start = m.index + m[0].length;
    const end = text0.indexOf('endstream', start);
    if (end < 0) continue;
    try {
      chunks.push(zlib.inflateSync(raw.subarray(start, end)));
    } catch {
      /* not every flate stream is one we can read standalone; skip it */
    }
  }
  const text = chunks.map((c) => c.toString('latin1')).join('\n');

  const count = (re) => (text.match(re) ?? []).length;

  /* Classify each link annotation by reading its own object, not by
     counting `/URI` across the whole file: a global count cannot tell a
     link's action from an unrelated dictionary that happens to carry the
     same key. */
  let links = 0;
  let external = 0;
  let internal = 0;
  const linkRe = /\/Subtype\s*\/Link/g;
  let hit;
  while ((hit = linkRe.exec(text))) {
    links += 1;
    const from = text.lastIndexOf('obj', hit.index);
    const to = text.indexOf('endobj', hit.index);
    const dict = text.slice(from < 0 ? hit.index : from, to < 0 ? hit.index + 400 : to);
    if (/\/URI/.test(dict)) external += 1;
    else if (/\/Dest|\/GoTo/.test(dict)) internal += 1;
  }

  /* Count the leaf page objects. The `/Count` on a `/Type /Pages` node is
     NOT the answer: Chromium builds a BALANCED tree for a long document,
     so the first node you meet carries the count of its own branch — eight,
     on a sixty-nine page file, which is a believable number and therefore
     the dangerous kind of wrong. */
  const leafPages = count(/\/Type\s*\/Page(?![s])/g);
  const treeCounts = [...text.matchAll(/\/Type\s*\/Pages[^>]{0,200}?\/Count\s+(\d+)/g)].map((m) =>
    Number(m[1]),
  );
  return {
    bytes: raw.length,
    pages: leafPages || (treeCounts.length ? Math.max(...treeCounts) : 0),
    links,
    external,
    internal,
    bookmarks: count(/\/Title\s*[(<]/g),
    outline: /\/Type\s*\/Outlines/.test(text) || /\/Outlines\s+\d+\s+\d+\s+R/.test(text),
  };
}

/* ───────────────────────────────── main ──────────────────────────────── */

function readJson(file, fallback, label) {
  if (!fs.existsSync(file)) {
    if (fallback === undefined) {
      console.error(`✗ ${label} not found: ${file}`);
      process.exit(1);
    }
    console.warn(`· no ${label} at ${file} — every video renders as "not uploaded yet"`);
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`✗ ${label} is not valid JSON (${file}): ${error.message}`);
    process.exit(1);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const library = readJson(args.library, undefined, 'library.json');
  const driveLinks = readJson(args.links, { videos: {} }, 'drive-links.json');

  const html = buildHtml(library, driveLinks);
  if (args.html) {
    fs.mkdirSync(path.dirname(args.html), { recursive: true });
    fs.writeFileSync(args.html, html);
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    /* `page.pdf()` forces print media; we want the screen palette on paper,
       so the emulation is set back explicitly and the backgrounds printed. */
    await page.emulateMedia({ media: 'screen' });
    await page.setContent(html, { waitUntil: 'load' });
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    await page.pdf({
      path: args.out,
      format: 'A4',
      printBackground: true,
      outline: true, // PDF bookmarks from the h1–h4 structure
      tagged: true, // and a document structure, for screen readers
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="width:100%;font-family:Arial,sans-serif;font-size:7pt;color:#4e5e70;
        padding:0 14mm;display:flex;justify-content:space-between;">
        <span>Skydrop — the tutorial library</span>
        <span class="pageNumber"></span>
      </div>`,
      margin: { top: '14mm', bottom: '16mm', left: '14mm', right: '14mm' },
    });
  } finally {
    await browser.close();
  }

  const report = inspectPdf(args.out);
  console.log(`✓ ${args.out}`);
  console.log(
    `  ${report.pages} pages · ${report.links} link annotations ` +
      `(${report.external} external, ${report.internal} in-document) · ` +
      `outline ${report.outline ? `written, ${report.bookmarks} bookmarks` : 'MISSING — use the linked contents instead'} · ` +
      `${(report.bytes / 1024).toFixed(0)} KB`,
  );
  if (report.links === 0) {
    console.error('✗ no clickable links in the output — the document is a picture, not a tool');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
