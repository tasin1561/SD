#!/usr/bin/env node
/**
 * Builds `library.json` — the "what exists" half of the tutorial-library
 * data contract in `SCHEMA.md`. The other half (`drive-links.json`) is
 * earned, not derived, and is deliberately not written here.
 *
 * EVERYTHING IN THE OUTPUT IS DERIVED. Nothing is typed by hand, because
 * the product moves and a hand-typed catalogue is wrong the first week
 * after it is written and silently wrong every week after that. The
 * sources, and what each one is the authority for:
 *
 *   · `CURRICULUM.md`            sections, per-tutorial order, the
 *                                **Promise** line (the summary) and the
 *                                **Covers** paths (part of `teaches`)
 *   · `narration.mjs`            every tutorial's slug, title and the
 *                                ordered scene ids
 *   · `long/*.mjs` + `index.mjs` the long walkthroughs and promos, their
 *                                section grouping and their own words
 *   · `flows.mjs` / `long/*.mjs` the routes a take actually visits — read
 *                                off the step functions' own source, so
 *                                `teaches` cannot drift from the film
 *   · `out/*.mp4` + ffprobe      which takes exist, and how long they are
 *   · `apps/<app>/src/app`       every console page that exists
 *   · each app's `i18n/messages` the page's real heading, resolved
 *   · each app's `authed-shell`  the sidebar group a page sits under
 *   · `CLAUDE.md`                the hostnames, and the UI word for a
 *                                console ("Client", not "seller")
 *
 * Run: `node scripts/tutorials/library/build-library.mjs`
 * It reads and probes only. It films nothing and seeds nothing.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TUTORIALS = path.resolve(HERE, '..');
const REPO = path.resolve(TUTORIALS, '..', '..');
const OUT_DIR = path.join(TUTORIALS, 'out');
const OUTPUT = path.join(HERE, 'library.json');

/** The app directory ← → console key. The UI word differs ON PURPOSE. */
const CONSOLES = [
  { key: 'admin', app: 'admin' },
  { key: 'client', app: 'seller' },
  { key: 'member', app: 'reseller' },
  { key: 'associate', app: 'associate' },
  { key: 'track', app: 'track' },
  { key: 'marketing', app: 'marketing' },
];

/** `flow.app` (a directory name) → the console key a reader knows. */
const APP_TO_CONSOLE = Object.fromEntries(CONSOLES.map((c) => [c.app, c.key]));

/** The languages a take can exist in, and the file suffix each uses. */
const LANGUAGES = [
  { code: 'en', suffix: '' },
  { code: 'bn', suffix: '-bn' },
  { code: 'hi', suffix: '-hi' },
];

const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);
const squash = (s) => s.replace(/\s+/g, ' ').trim();

/* ─────────────────────────── hostnames ──────────────────────────────
 * From the table at the top of CLAUDE.md rather than from memory: the
 * hostnames moved once already (CON-1/CON-2) and the generated links in
 * a PDF are exactly the thing that goes stale without anybody noticing.
 */
function hostsFromClaudeMd() {
  const rows = read(path.join(REPO, 'CLAUDE.md'))
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .map((l) =>
      l
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim()),
    )
    .filter((cells) => cells.length >= 2);

  const hosts = new Map();
  const uiNames = new Map();

  for (const [label, hostCell] of rows) {
    // `admin.` / `api.` / `track.skydrop.global` — a trailing-dot token
    // borrows the domain from the fully-qualified one beside it.
    const tokens = [...hostCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (tokens.length === 0) continue;
    const full = tokens.find((t) => t.includes('.global'));
    if (full === undefined) continue;
    const domain = full.slice(full.indexOf('skydrop.global'));
    const resolved = tokens.map((t) => (t.endsWith('.') ? `${t}${domain}` : t));

    // The UI word, where the table gives one: `seller ("Client" in the UI)`.
    const quoted = /"([^"]+)"/.exec(label);

    for (const word of label.split('/').map((w) => w.trim())) {
      const bare = word.replace(/\s*\(.*$/, '').trim();
      if (bare === '') continue;
      const host = resolved.find((h) => h === bare || h.startsWith(`${bare}.`)) ?? resolved[0];
      hosts.set(bare, `https://${host}`);
      if (quoted !== null) uiNames.set(bare, quoted[1]);
    }
  }
  return { hosts, uiNames };
}

/* ───────────────────────── i18n resolution ──────────────────────────
 * A message file is a flat table of `'key': ['English', 'Bengali']`, so
 * the English heading of a page is resolvable rather than guessable.
 */
function messagesFor(app) {
  const out = new Map();
  const unescape = (s) => squash(s.replace(/\\(['"`\\])/g, '$1'));

  const dir = path.join(REPO, 'apps', app, 'src', 'i18n', 'messages');
  if (exists(dir)) {
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const src = read(path.join(dir, file));
      const re = /(['"])([\w.\-[\]]+)\1\s*:\s*\[\s*(['"`])((?:\\.|(?!\3)[\s\S])*?)\3/g;
      for (const m of src.matchAll(re)) if (!out.has(m[2])) out.set(m[2], unescape(m[4]));
    }
  }

  // The public tracking app predates that convention and keeps one
  // object per language in `lib/i18n.ts`, English first. First
  // occurrence of a key therefore IS the English one.
  const legacy = path.join(REPO, 'apps', app, 'src', 'lib', 'i18n.ts');
  if (exists(legacy)) {
    const src = read(legacy);
    for (const m of src.matchAll(/^\s{2}(\w+):\s*'((?:\\.|[^'])*)',?\s*$/gm)) {
      if (!out.has(m[1])) out.set(m[1], unescape(m[2]));
    }
  }
  return out;
}

/* ───────────────────────── the sidebar groups ───────────────────────
 * `authed-shell.tsx` declares `heading: t(…)` followed by the `href`s
 * that sit under it, in order. That IS the grouping a person sees, so a
 * page's `section` is read from it instead of being invented.
 */
function navGroupsFor(app, messages) {
  const shell = path.join(
    REPO,
    'apps',
    app,
    'src',
    'app',
    '(authed)',
    '_components',
    'authed-shell.tsx',
  );
  const map = new Map();
  if (!exists(shell)) return map;
  const src = read(shell);
  const re = /heading:\s*t\(\s*'([^']+)'|href:\s*'([^']+)'/g;
  let heading = null;
  for (const m of src.matchAll(re)) {
    if (m[1] !== undefined) {
      heading = messages.get(m[1]) ?? null;
    } else if (m[2] !== undefined && heading !== null && !map.has(m[2])) {
      map.set(m[2], heading);
    }
  }
  return map;
}

/* ──────────────────────────── the pages ─────────────────────────────── */

function pageFiles(appRoot) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'page.tsx') found.push(full);
    }
  };
  walk(appRoot);
  return found.sort();
}

/** `…/src/app/(authed)/warehouse/pack/page.tsx` → `/warehouse/pack`. */
function routeOf(appRoot, file) {
  const rel = path.relative(appRoot, path.dirname(file));
  const segments = rel
    .split(path.sep)
    .filter((s) => s !== '' && s !== '.')
    .filter((s) => !(s.startsWith('(') && s.endsWith(')'))) // route group
    .filter((s) => !s.startsWith('@')); // parallel route slot
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

const isDynamic = (s) => s.startsWith('[');

const titleCase = (s) => (s === '' ? s : s[0].toUpperCase() + s.slice(1));

/** The last-resort title: the route, made readable. */
function humanisePath(route) {
  const segments = route.split('/').filter((s) => s !== '');
  if (segments.length === 0) return 'Home';
  const last = segments[segments.length - 1];
  const named = [...segments].reverse().find((s) => !isDynamic(s));
  const base = titleCase((named ?? last).replace(/[[\]().]/g, '').replace(/[-_]+/g, ' '));
  return isDynamic(last) ? `${base} detail` : base;
}

/**
 * The page's own heading, where the component states one.
 *
 * A Next.js page in this repo is usually three lines that render a
 * component out of `./_components`, so the heading is one or two hops
 * away and a search of `page.tsx` alone finds almost nothing. The hops
 * are followed in import order and no further than the app itself.
 */
/**
 * One of several titles a page states, chosen by the route.
 *
 * A sign-in route renders its card once per branch — the link is
 * invalid, the token is missing, the form — so the file holds three
 * headings and all three are real. The route is the only thing in the
 * repository that says which one the page is FOR, so the one sharing
 * most words with it wins, and the first wins a tie.
 */
function bestForRoute(values, route) {
  const wanted = new Set(
    route
      .split(/[^A-Za-z]+/)
      .filter((w) => w !== '')
      .map((w) => w.toLowerCase()),
  );
  let best = values[0];
  let bestScore = -1;
  for (const value of values) {
    const score = value
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => wanted.has(w)).length;
    if (score > bestScore) {
      best = value;
      bestScore = score;
    }
  }
  return best;
}

function headingFor(file, appRoot, messages, route) {
  const seen = new Set();
  const queue = [file];
  const resolveLocal = (fromFile, spec) => {
    const base = path.resolve(path.dirname(fromFile), spec);
    if (!base.startsWith(appRoot)) return null;
    for (const candidate of [`${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx')]) {
      if (exists(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
  };

  while (queue.length > 0 && seen.size < 24) {
    const current = queue.shift();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    const src = read(current);

    const literal = (raw) => {
      const text = squash(raw);
      // A JSX expression, a fragment of markup or a sentence is not a
      // heading; only take what reads as one.
      if (text === '' || text.length > 60) return null;
      if (/[<>{}]/.test(text)) return null;
      return text;
    };

    // Every `title` prop in the file, each kept with the tag it sits on
    // and its position. `[^>]` keeps a match inside ONE jsx tag, so a
    // `title` belonging to a later element is never read as this one's.
    // `t` in most apps, `tr` where a component already has a local `t`.
    const titles = [];
    for (const m of src.matchAll(
      /<([A-Z]\w*)\b[^>]{0,800}?\btitle=(\{\s*tr?\(\s*(?:locale\s*,\s*)?'([^']+)'|"([^"]+)"|\{\s*'([^']+)'\s*\}|\{)/g,
    )) {
      const resolved = m[3] !== undefined ? messages.get(m[3]) : literal(m[4] ?? m[5] ?? '');
      titles.push({ index: m.index, tag: m[1], value: resolved ?? null });
    }

    // `<PageHeader>` almost everywhere, `<AcHeader>` in the admin
    // account screens: a tag whose NAME ends in Header is the page's own
    // heading, and nothing else in the file outranks it. A card's title,
    // a column's title or an empty state's title further down the page
    // is NOT the page's — which is the whole reason this is matched by
    // the tag rather than by "the first title in the file".
    const header = titles.find((c) => c.tag.endsWith('Header'));
    if (header !== undefined) {
      // A header whose title is a variable — the client's name, the
      // store's name — genuinely has no fixed heading, so say so with
      // the path rather than reaching further down the file for
      // something that is not the heading.
      return header.value !== null && !header.value.includes('{') ? header.value : null;
    }

    const h1s = [
      ...[...src.matchAll(/<h1[^>]*>\s*\{\s*tr?\(\s*(?:locale\s*,\s*)?'([^']+)'/g)].map((m) =>
        messages.get(m[1]),
      ),
      ...[...src.matchAll(/<h1[^>]*>([^<{][^<]*)<\/h1>/g)].map((m) => literal(m[1])),
    ].filter((v) => typeof v === 'string' && !v.includes('{'));
    if (h1s.length > 0) return bestForRoute(h1s, route);

    // No header component and no `h1`: the titles the page states for
    // itself. On the sign-in routes that is a `SignInCard`, rendered
    // once per branch — so a page can offer several, and the ROUTE
    // decides which, because the route is what names the page. Only a
    // page that declares no header at all reaches this; the detail
    // screens, where the first title belongs to a card and not to the
    // page, were answered above.
    const resolvable = titles.map((c) => c.value).filter((v) => v !== null && !v.includes('{'));
    if (resolvable.length > 0) return bestForRoute(resolvable, route);

    for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
      const next = resolveLocal(current, m[1]);
      if (next !== null) queue.push(next);
    }
  }
  return null;
}

function pagesFor(app) {
  const appRoot = path.join(REPO, 'apps', app, 'src', 'app');
  if (!exists(appRoot)) return [];
  const messages = messagesFor(app);
  const nav = navGroupsFor(app, messages);

  return pageFiles(appRoot).map((file) => {
    const route = routeOf(appRoot, file);
    const heading = headingFor(file, appRoot, messages, route);

    // The sidebar names the group for a listed route; a child route
    // inherits from the longest listed ancestor, which is where it sits.
    let section;
    for (const [href, group] of nav) {
      if (route === href || route.startsWith(`${href}/`)) {
        if (section === undefined || href.length > section.href.length) section = { href, group };
      }
    }

    const page = {
      path: route,
      title: heading ?? humanisePath(route),
      titleSource: heading === null ? 'path' : 'heading',
    };
    if (section !== undefined) page.section = section.group;
    return page;
  });
}

/* ───────────────────────── CURRICULUM.md ─────────────────────────────
 * The catalogue. A tutorial's section, its order inside that section,
 * its one-sentence promise and the routes it covers are all stated here
 * in the document's own words, and all four are taken verbatim.
 */
function parseCurriculum() {
  const lines = read(path.join(TUTORIALS, 'CURRICULUM.md')).split('\n');
  const sections = new Map(); // letter → "A — Day one: …"
  const entries = [];

  let section = null;
  let current = null;
  const close = () => {
    if (current !== null) entries.push(current);
    current = null;
  };

  for (const line of lines) {
    const sectionMatch = /^## ([A-Z]) — (.+?)\s*$/.exec(line);
    if (sectionMatch !== null) {
      close();
      section = { letter: sectionMatch[1], heading: `${sectionMatch[1]} — ${sectionMatch[2]}` };
      sections.set(section.letter, section.heading);
      continue;
    }
    if (/^## /.test(line) || /^# /.test(line)) {
      close();
      section = null;
      continue;
    }

    const entryMatch = /^(#{3,4}) (.+?)\s*$/.exec(line);
    if (entryMatch !== null) {
      close();
      if (section === null) continue;
      const rest = entryMatch[2];
      const code = /^([A-Z]\d+(?:\s*[–—-]\s*[A-Z]?\d+)?)\s*[.·—]?\s*/.exec(rest);
      const afterCode = code === null ? rest : rest.slice(code[0].length);
      const title = squash(afterCode.split('·')[0].replace(/[—–-]\s*$/, '')).replace(
        /\s*—\s*$/,
        '',
      );
      current = {
        section: section.heading,
        code: code === null ? null : squash(code[1]).replace(/\s*[–—-]\s*/, '–'),
        title: title.replace(/^[—–-]\s*/, ''),
        slugsFromHeading: [...rest.matchAll(/`([a-z0-9-]+)\.mp4`/g)].map((m) => m[1]),
        // A heading with neither a catalogue code nor an mp4 is prose
        // inside a section ("What the build found…"), not an entry.
        notATutorial:
          /\(not a tutorial\)/i.test(rest) || (code === null && !/`[a-z0-9-]+\.mp4`/.test(rest)),
        body: [],
      };
      continue;
    }
    if (current !== null) current.body.push(line);
  }
  close();

  for (const entry of entries) {
    const body = entry.body.join('\n');
    const promise = /\*\*Promise\*\*\s*[—–-]\s*([\s\S]*?)(?=\n\s*\n|\n\*\*|$)/.exec(body);
    entry.promise = promise === null ? null : squash(promise[1].replace(/\*\*/g, ''));
    // Most entries bold the field name; the earliest ones write the
    // paragraph plainly ("Covers `/orders/new` end to end: …"), and both
    // are the same field.
    const covers = /^(?:\*\*)?Covers(?:\*\*)?\s*([\s\S]*?)(?=\n\s*\n|$)/m.exec(body);
    entry.covers =
      covers === null
        ? []
        : [...covers[1].matchAll(/`(\/[A-Za-z0-9\-/[\]]*)`/g)].map((m) => m[1].replace(/\/$/, ''));
    // Children of an `###` entry carry their own `####` headings; the
    // parent's own mp4 list is what identifies it.
    delete entry.body;
  }
  return { sections, entries };
}

/* ─────────────────── the scene index, per tutorial ──────────────────── */

const humaniseId = (id) => titleCase(id.replace(/[-_]+/g, ' '));

/**
 * The long videos' own section banners, which are human headings and are
 * what a reader of a 90-minute script wants instead of 302 scene ids.
 *
 * Two shapes exist in `long/*.mjs` and both are read from the source:
 *   · `steps: [...H_SAY, ...I_SAY, …]` — one array per CURRICULUM
 *     section, so the letter resolves to that section's own heading;
 *   · `/* ── act three: freight ── *\/` banners inside one array.
 * A module with neither grouping falls back to its scene ids.
 */
function longVideoSteps(slug, narration, sections) {
  const file = path.join(TUTORIALS, 'long', `${moduleFileFor(slug)}.mjs`);
  if (!exists(file)) return narration.steps.map((s) => humaniseId(s.id));
  const src = read(file);

  const composed = /steps:\s*\[([^\]]*\.\.\.[A-Z]_SAY[^\]]*)\]/.exec(src);
  if (composed !== null) {
    const letters = [...composed[1].matchAll(/\.\.\.([A-Z])_SAY/g)].map((m) => m[1]);
    // The module's own docblock spine ("H  the desk") where it has one,
    // else the CURRICULUM section heading for that letter.
    const spine = new Map(
      [...src.matchAll(/^\s*\*\s{2,}([A-Z])\s{2,}(\S[^\n]*?)\s{2,}\S/gm)].map((m) => [
        m[1],
        squash(m[2]),
      ]),
    );
    const headings = letters
      .map((letter) => {
        const own = spine.get(letter);
        if (own !== undefined) return `${letter} — ${own}`;
        return sections.get(letter) ?? letter;
      })
      .filter((h, i, all) => all.indexOf(h) === i);
    if (headings.length > 0) return headings;
  }

  const narrationStart = src.indexOf('export const narration');
  const narrationEnd = src.indexOf('export const flow');
  if (narrationStart !== -1 && narrationEnd > narrationStart) {
    const banners = [
      ...src
        .slice(narrationStart, narrationEnd)
        .matchAll(/\/\*\s*[─—-]{2,}\s*(.+?)\s*[─—-]{2,}\s*\*\//g),
    ]
      .map((m) => squash(m[1]))
      .filter((t) => t !== '' && !/^flow$/i.test(t))
      .map((t) => titleCase(t));
    if (banners.length > 1) return banners;
  }

  return narration.steps.map((s) => humaniseId(s.id));
}

/** `seller-everything` → `seller`, `promo-seller` → `promo-seller`. */
function moduleFileFor(slug) {
  return slug.startsWith('promo-') ? slug : slug.replace(/-everything$/, '');
}

/* ───────────────────── what a take actually visits ───────────────────
 * Read off the step functions' OWN source via `Function.toString()`, so
 * `teaches` is what the camera does rather than a second list that can
 * disagree with it. Only literal paths count — a templated one is not
 * knowable here and is omitted rather than guessed.
 */
function routesVisited(flow) {
  if (flow === undefined || flow.steps === undefined) return [];
  const src = Object.values(flow.steps)
    .map((fn) => (typeof fn === 'function' ? fn.toString() : ''))
    .join('\n');
  const found = new Set();
  const patterns = [
    /\$\{(?:ctx\.)?baseUrl\}(\/[A-Za-z0-9\-/[\]]*)/g,
    /\b(?:go|visit)\(\s*ctx\s*,\s*'(\/[^']*)'/g,
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const route = m[1].split('?')[0].split('#')[0].replace(/\/$/, '');
      if (route !== '') found.add(route);
    }
  }

  // The long videos click the sidebar instead of navigating by URL, and
  // `openNav(ctx, 'Wallet', /\/wallet$/)` carries the route it waits
  // for. That regex is the only statement of where the click lands, so
  // it is read — but only when it is a plain anchored literal.
  for (const m of src.matchAll(/openNav\([^,]+,\s*'[^']*',\s*\/([^/]+)\//g)) {
    const route = m[1]
      .replace(/\(\\\?\|\$\)$/, '')
      .replace(/\$$/, '')
      .replace(/^\^/, '')
      .replace(/\\\//g, '/');
    if (/^\/[A-Za-z0-9\-/]*$/.test(route) && route !== '/') found.add(route.replace(/\/$/, ''));
  }
  return [...found];
}

/* ──────────────────────────── durations ─────────────────────────────── */

function durationOf(file) {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { encoding: 'utf8' },
    );
    const seconds = Number.parseFloat(out.trim());
    return Number.isFinite(seconds) ? Math.round(seconds) : null;
  } catch {
    return null;
  }
}

/* ────────────────────────────── build ──────────────────────────────── */

const normaliseTitle = (s) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|your|my)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

async function main() {
  const { VIDEOS } = await import(path.join(TUTORIALS, 'narration.mjs'));
  const { FLOWS } = await import(path.join(TUTORIALS, 'flows.mjs'));
  const { LONG_VIDEOS, LONG_FLOWS } = await import(path.join(TUTORIALS, 'long', 'index.mjs'));

  const { hosts, uiNames } = hostsFromClaudeMd();
  const { sections, entries } = parseCurriculum();

  /* ── consoles, with their pages ── */
  const readers = readerTable();
  const consoles = CONSOLES.map(({ key, app }) => {
    const console_ = {
      key,
      name: uiNames.get(app) ?? titleCase(app),
      host: hosts.get(app) ?? hosts.get(key) ?? null,
      pages: pagesFor(app),
    };
    const who = readers.get(app) ?? metadataDescription(app);
    if (who !== null) console_.who = who;
    return console_;
  });

  const routesByConsole = new Map(
    consoles.map((c) => [c.key, new Set(c.pages.map((p) => p.path))]),
  );

  /* ── tutorials ── */
  const longSlugs = new Set(LONG_VIDEOS.map((v) => v.slug));
  const byTitle = new Map();
  for (const v of VIDEOS) {
    const keyed = normaliseTitle(v.title);
    if (!byTitle.has(keyed)) byTitle.set(keyed, v.slug);
  }

  // Each CURRICULUM entry → the slug(s) it describes. The heading names
  // the mp4 where it has been filmed; where it has not, the entry's own
  // title is matched against the narration's.
  const entryFor = new Map();
  const orderInSection = new Map();
  for (const entry of entries) {
    if (entry.notATutorial) continue;
    let slugs = entry.slugsFromHeading.filter((s) => VIDEOS.some((v) => v.slug === s));
    if (slugs.length === 0) {
      const guess = byTitle.get(normaliseTitle(entry.title));
      if (guess !== undefined) slugs = [guess];
    }
    for (const slug of slugs) {
      if (entryFor.has(slug)) continue;
      const next = (orderInSection.get(entry.section) ?? 0) + 1;
      orderInSection.set(entry.section, next);
      entryFor.set(slug, { ...entry, order: next });
    }
  }

  // The long walkthroughs and the promos are not in CURRICULUM — they
  // are the path THROUGH it — so their section is their kind and their
  // order is the order `long/index.mjs` means them to be watched in.
  const longOrder = new Map();
  for (const kind of ['long', 'promo']) {
    let n = 0;
    for (const v of LONG_VIDEOS) {
      const isPromo = v.slug.startsWith('promo-');
      if ((kind === 'promo') !== isPromo) continue;
      longOrder.set(v.slug, ++n);
    }
  }
  const unmatched = [];

  const tutorials = VIDEOS.map((video) => {
    const slug = video.slug;
    const isPromo = slug.startsWith('promo-');
    const isLong = longSlugs.has(slug) && !isPromo;
    const kind = isPromo ? 'promo' : isLong ? 'long' : 'short';
    const flow = LONG_FLOWS[slug] ?? FLOWS[slug];
    const consoleKey = APP_TO_CONSOLE[flow?.app ?? 'seller'];
    const entry = entryFor.get(slug);

    if (entry === undefined && kind === 'short') unmatched.push(slug);

    /* which takes exist on disk */
    const files = {};
    const languages = [];
    for (const { code, suffix } of LANGUAGES) {
      const name = `${slug}${suffix}.mp4`;
      if (exists(path.join(OUT_DIR, name))) {
        languages.push(code);
        files[code] = name;
      }
    }

    /* the summary, in the document's own words */
    let summary = null;
    if (entry?.promise != null) {
      summary = titleCase(entry.promise.replace(/\s*\.$/, ''));
      if (!summary.endsWith('.')) summary += '.';
    } else {
      // A long video or a promo is not in CURRICULUM; the nearest thing
      // to a promise it states is its own opening line, so that is what
      // is used — the video's words, not a fresh claim about the product.
      const first = video.steps[0]?.say;
      if (typeof first === 'string') {
        const said = squash(first);
        const two = /^(.*?[.!?](?:\s+.*?[.!?])?)(\s|$)/.exec(said);
        summary = two === null ? said : two[1];
      }
    }

    /* the scene index */
    const steps =
      kind === 'short'
        ? video.steps.map((s) => humaniseId(s.id))
        : longVideoSteps(slug, video, sections);

    /* the pages it covers, kept only where the route really exists */
    const known = routesByConsole.get(consoleKey) ?? new Set();
    const teaches = [...new Set([...(entry?.covers ?? []), ...routesVisited(flow)])]
      .filter((route) => known.has(route))
      .sort();

    const tutorial = {
      slug,
      title: video.title,
      console: consoleKey,
      kind,
      section:
        entry?.section ?? (isPromo ? 'Promos' : isLong ? 'Long walkthroughs' : 'Unsectioned'),
      order: entry?.order ?? longOrder.get(slug) ?? 0,
      summary,
      steps,
      durationSeconds:
        languages.length === 0 ? null : durationOf(path.join(OUT_DIR, files[languages[0]])),
      languages,
      files,
    };
    if (teaches.length > 0) tutorial.teaches = teaches;
    return tutorial;
  });

  const library = { generatedAt: new Date().toISOString(), consoles, tutorials };
  fs.writeFileSync(OUTPUT, await formatted(library));
  report(library, unmatched, entries, entryFor);
}

/**
 * The output, written the way `pnpm gate`'s `format:check` expects it.
 *
 * A generated file still has to pass the same formatter as a hand-written
 * one, and `JSON.stringify` does not agree with prettier about short
 * arrays — so the generator formats its own output rather than leaving a
 * red gate for whoever runs it next. Prettier is a workspace devDep; if
 * it cannot be resolved the plain form is written and the file is still
 * correct, just not formatted.
 */
async function formatted(library) {
  const json = `${JSON.stringify(library, null, 2)}\n`;
  try {
    const prettier = await import('prettier');
    const api = prettier.default ?? prettier;
    const options = (await api.resolveConfig(OUTPUT)) ?? {};
    return await api.format(json, { ...options, filepath: OUTPUT, parser: 'json' });
  } catch {
    return json;
  }
}

/**
 * The reader of each app, from CURRICULUM.md's own summary table — the
 * `who` line, in the document's words rather than a fresh description.
 */
function readerTable() {
  const out = new Map();
  for (const line of read(path.join(TUTORIALS, 'CURRICULUM.md')).split('\n')) {
    const m = /^\|[^|]*\|\s*`apps\/(\w+)`\s*\|\s*([^|]+?)\s*\|/.exec(line);
    if (m !== null) out.set(m[1], squash(m[2]));
  }
  return out;
}

/** A public app has no reader row; its own metadata says what it is for. */
function metadataDescription(app) {
  const layout = path.join(REPO, 'apps', app, 'src', 'app', 'layout.tsx');
  if (!exists(layout)) return null;
  const m = /description:\s*\n?\s*'((?:\\.|[^'])*)'/.exec(read(layout));
  return m === null ? null : squash(m[1].replace(/\\(['\\])/g, '$1'));
}

function report(library, unmatched, entries, entryFor) {
  const byKind = library.tutorials.reduce((acc, t) => {
    acc[t.kind] = (acc[t.kind] ?? 0) + 1;
    return acc;
  }, {});

  const withFile = library.tutorials.filter((t) => t.languages.length > 0);
  const missingDuration = withFile.filter((t) => t.durationSeconds === null);
  const nullTitles = library.consoles.flatMap((c) => c.pages.filter((p) => p.title == null));
  const headingTitles = library.consoles.flatMap((c) =>
    c.pages.filter((p) => p.titleSource === 'heading'),
  );
  const totalPages = library.consoles.reduce((n, c) => n + c.pages.length, 0);

  const say = (...args) => process.stdout.write(`${args.join(' ')}\n`);
  say(`wrote ${path.relative(REPO, OUTPUT)}`);
  say('');
  say('tutorials by kind:');
  for (const kind of ['short', 'long', 'promo']) say(`  ${kind.padEnd(6)} ${byKind[kind] ?? 0}`);
  say(`  ${'TOTAL'.padEnd(6)} ${library.tutorials.length}`);
  say('');
  say('pages by console:');
  for (const c of library.consoles) {
    const headings = c.pages.filter((p) => p.titleSource === 'heading').length;
    say(
      `  ${c.key.padEnd(10)} ${String(c.pages.length).padStart(3)}  (${headings} titled from a heading)`,
    );
  }
  say(
    `  ${'TOTAL'.padEnd(10)} ${String(totalPages).padStart(3)}  (${headingTitles.length} from a heading)`,
  );
  say('');
  say(
    `takes on disk: ${withFile.reduce((n, t) => n + t.languages.length, 0)} across ${withFile.length} tutorials`,
  );
  say(
    `tutorials with a file but no duration: ${missingDuration.length}` +
      (missingDuration.length > 0 ? ` — ${missingDuration.map((t) => t.slug).join(', ')}` : ''),
  );
  say(`pages with a null title: ${nullTitles.length}`);
  say(`tutorials with no summary: ${library.tutorials.filter((t) => t.summary == null).length}`);
  say(
    `tutorials with no teaches: ${library.tutorials.filter((t) => t.teaches === undefined).length}`,
  );
  say('');
  say(`CURRICULUM entries parsed: ${entries.length}, mapped to a slug: ${entryFor.size}`);
  if (unmatched.length > 0)
    say(`short tutorials with no CURRICULUM entry (${unmatched.length}): ${unmatched.join(', ')}`);
  const orphanEntries = entries
    .filter((e) => !e.notATutorial)
    .filter(
      (e) => ![...entryFor.values()].some((v) => v.code === e.code && v.section === e.section),
    );
  if (orphanEntries.length > 0) {
    say(`CURRICULUM entries with no tutorial (${orphanEntries.length}):`);
    for (const e of orphanEntries) say(`  ${e.section} · ${e.code ?? '—'} ${e.title}`);
  }
}

await main();
