/**
 * Saved language eval for the in-app assistant.
 *
 *   pnpm --filter @skydrop/api exec ts-node --transpile-only scripts/assistant-eval.ts --dry
 *   ASSISTANT_EVAL_PASSWORD=... pnpm --filter @skydrop/api exec ts-node --transpile-only scripts/assistant-eval.ts --sample 8
 *
 * It asks a running API the cases in apps/api/eval/assistant/*.json, one fresh
 * conversation per case, and checks the answer for: the right language and
 * script, the expected page link, forbidden content absent, expected words
 * present. It writes a markdown report.
 *
 * IT COSTS REAL MONEY AND MUST NEVER RUN IN CI. `--dry` (no network, no login,
 * no spend) only validates the case files and IS run by a unit spec.
 *
 * Login comes from the environment, never from a file:
 *   ASSISTANT_EVAL_TARGET            default https://api.skydrop.global
 *   ASSISTANT_EVAL_EMAIL             staff account, default qa-bot@skydrop.global
 *   ASSISTANT_EVAL_PASSWORD          staff password (required for staff cases)
 *   ASSISTANT_EVAL_SELLER_EMAIL / _SELLER_PASSWORD   optional: runs seller cases
 *   ASSISTANT_EVAL_STORE_EMAIL  / _STORE_PASSWORD    optional: runs store cases
 * A case whose audience has no login is reported as skipped, not failed.
 *
 * Logging in is throttled (5 per 15 minutes per email and IP), so each
 * audience logs in ONCE per run and the token is reused.
 *
 * Flags: --dry  --target URL  --audience staff|seller|store|associate
 *        --lang en|bn|banglish|hi|hinglish  --kind language|where|error|refusal
 *        --only id,id  --sample N  --all (needed to run more than 10)
 *        --out path/to/report.md
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { detectReplyLanguage } from '../src/modules/assistant/assistant-language';

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

const CASE_DIR = join(__dirname, '../eval/assistant');
const BENGALI = /[ঀ-৿]/g;
// Without U+0964/0965 (the danda): Bangla uses it too, so it says nothing about the script.
const DEVANAGARI = /[ऀ-ॣ०-ॿ]/g;

export function loadCases(dir: string = CASE_DIR): EvalCase[] {
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

// ------------------------------------------------------------------ runner

interface Args {
  dry: boolean;
  target: string;
  audience: string | null;
  lang: string | null;
  kind: string | null;
  only: string[] | null;
  sample: number | null;
  all: boolean;
  out: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  const a: Args = {
    dry: false,
    target: process.env.ASSISTANT_EVAL_TARGET ?? 'https://api.skydrop.global',
    audience: null,
    lang: null,
    kind: null,
    only: null,
    sample: null,
    all: false,
    out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = (): string => argv[++i] ?? '';
    if (k === '--dry') a.dry = true;
    else if (k === '--all') a.all = true;
    else if (k === '--target') a.target = next();
    else if (k === '--audience') a.audience = next();
    else if (k === '--lang') a.lang = next();
    else if (k === '--kind') a.kind = next();
    else if (k === '--only') a.only = next().split(',');
    else if (k === '--sample') a.sample = Number(next());
    else if (k === '--out') a.out = next();
  }
  return a;
}

/** Spread N picks across kinds and languages so a small run still covers each. */
export function pickSample(cases: readonly EvalCase[], n: number): EvalCase[] {
  const buckets = new Map<string, EvalCase[]>();
  for (const c of cases) {
    const key = `${c.kind}:${c.language}`;
    buckets.set(key, [...(buckets.get(key) ?? []), c]);
  }
  const queues = [...buckets.values()];
  const picked: EvalCase[] = [];
  for (let round = 0; picked.length < n && queues.some((q) => q.length > round); round++) {
    for (const q of queues) {
      const c = q[round];
      if (c !== undefined && picked.length < n) picked.push(c);
    }
  }
  return picked;
}

const ROUTE: Record<EvalAudience, { login: string; base: string }> = {
  staff: { login: '/auth/staff/login', base: '/admin/assistant' },
  seller: { login: '/auth/seller/login', base: '/seller/assistant' },
  store: { login: '/auth/store/login', base: '/store/assistant' },
  associate: { login: '/auth/store/login', base: '/store/assistant' },
};

function credentials(audience: EvalAudience): { email: string; password: string } | null {
  const env = process.env;
  const pick = (e: string | undefined, p: string | undefined) =>
    e !== undefined && e !== '' && p !== undefined && p !== '' ? { email: e, password: p } : null;
  if (audience === 'staff')
    return pick(env.ASSISTANT_EVAL_EMAIL ?? 'qa-bot@skydrop.global', env.ASSISTANT_EVAL_PASSWORD);
  if (audience === 'seller')
    return pick(env.ASSISTANT_EVAL_SELLER_EMAIL, env.ASSISTANT_EVAL_SELLER_PASSWORD);
  return pick(env.ASSISTANT_EVAL_STORE_EMAIL, env.ASSISTANT_EVAL_STORE_PASSWORD);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function login(target: string, audience: EvalAudience): Promise<string | null> {
  const creds = credentials(audience);
  if (creds === null) return null;
  const res = await fetch(`${target}${ROUTE[audience].login}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(creds),
  });
  if (!res.ok) throw new Error(`${audience} login failed: HTTP ${res.status}`);
  const body = (await res.json()) as { accessToken?: string };
  if (body.accessToken === undefined) throw new Error(`${audience} login returned no token`);
  return body.accessToken;
}

async function postJson<T>(url: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).pathname}`);
  return (await res.json()) as T;
}

interface Turn {
  answer: Answer;
  tools: string[];
  notices: string[];
  error: string | null;
}

async function ask(
  target: string,
  audience: EvalAudience,
  token: string,
  q: string,
): Promise<Turn> {
  const base = `${target}${ROUTE[audience].base}`;
  const conv = await postJson<{ id?: string; conversation?: { id: string } }>(
    `${base}/conversations`,
    token,
    { title: 'eval' },
  );
  const id = conv.id ?? conv.conversation?.id;
  if (id === undefined) throw new Error('conversation create returned no id');
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}/conversations/${id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: q }),
      signal: AbortSignal.timeout(180_000),
    });
    if (res.status === 429 && attempt === 0) {
      await sleep(35_000);
      continue;
    }
    if (!res.ok || res.body === null) throw new Error(`HTTP ${res.status} on send`);
    const turn: Turn = { answer: { text: '', links: [] }, tools: [], notices: [], error: null };
    let text = '';
    const links: string[] = [];
    const raw = await res.text();
    for (const line of raw.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const ev = JSON.parse(line.slice(5)) as {
        type: string;
        delta?: string;
        name?: string;
        code?: string;
        text?: string;
        helpLinks?: { path: string }[];
      };
      if (ev.type === 'text') text += ev.delta ?? '';
      else if (ev.type === 'tool') turn.tools.push(ev.name ?? '?');
      else if (ev.type === 'notice') {
        turn.notices.push(ev.code ?? '?');
        for (const l of ev.helpLinks ?? []) links.push(l.path);
        if (ev.code === 'FAILED') turn.error = ev.text ?? 'FAILED';
      }
    }
    return { ...turn, answer: { text, links: [...extractLinks(text), ...links] } };
  }
}

/** The staff billing line (month to date). Null when the panel is not reachable. */
async function billedToDate(target: string, token: string): Promise<number | null> {
  try {
    const res = await fetch(`${target}/admin/assistant-panel/billing/monthly?months=1`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { months?: { total?: { costUsd?: string } }[] };
    const v = body.months?.[0]?.total?.costUsd;
    return v === undefined ? null : Number(v);
  } catch {
    return null;
  }
}

interface Result {
  readonly c: EvalCase;
  readonly status: 'pass' | 'fail' | 'skipped' | 'error';
  readonly verdict: Verdict | null;
  readonly turn: Turn | null;
  readonly detail: string;
  readonly ms: number;
}

export function renderReport(
  results: readonly Result[],
  meta: { target: string; startedAt: string; costUsd: number | null },
): string {
  const ran = results.filter((r) => r.status === 'pass' || r.status === 'fail');
  const passed = results.filter((r) => r.status === 'pass').length;
  const lines: string[] = [];
  lines.push('# Assistant eval report', '');
  lines.push(`- Target: ${meta.target}`, `- Started: ${meta.startedAt}`);
  lines.push(
    `- Cases: ${results.length} selected, ${ran.length} answered, ${passed} passed, ` +
      `${results.filter((r) => r.status === 'fail').length} failed, ` +
      `${results.filter((r) => r.status === 'error').length} errored, ` +
      `${results.filter((r) => r.status === 'skipped').length} skipped (no login)`,
  );
  lines.push(
    meta.costUsd === null
      ? '- Cost: not available (billing line unreachable)'
      : `- Cost of this run (billed scale, month-to-date delta, may include other traffic): $${meta.costUsd.toFixed(4)}` +
          (ran.length > 0 ? ` (about $${(meta.costUsd / ran.length).toFixed(4)} per answer)` : ''),
  );
  lines.push('', '## By kind and language', '', '| Group | Passed | Of |', '|---|---|---|');
  const groups = new Map<string, { p: number; n: number }>();
  for (const r of ran) {
    for (const k of [`kind: ${r.c.kind}`, `language: ${r.c.language}`]) {
      const g = groups.get(k) ?? { p: 0, n: 0 };
      g.n++;
      if (r.status === 'pass') g.p++;
      groups.set(k, g);
    }
  }
  for (const [k, g] of [...groups.entries()].sort()) lines.push(`| ${k} | ${g.p} | ${g.n} |`);
  lines.push(
    '',
    '## Cases',
    '',
    '| Case | Result | Language | Link | Tools | Seconds |',
    '|---|---|---|---|---|---|',
  );
  for (const r of results) {
    const v = r.verdict;
    lines.push(
      `| ${r.c.id} | ${r.status.toUpperCase()} | ${v === null ? '-' : v.languageOk ? 'ok' : 'WRONG'} | ` +
        `${v === null || (r.c.expectLinks?.length ?? 0) === 0 ? '-' : v.linksMissing.length === 0 ? 'ok' : 'MISSING'} | ` +
        `${r.turn?.tools.join(', ') || '-'} | ${(r.ms / 1000).toFixed(1)} |`,
    );
  }
  const bad = results.filter((r) => r.status === 'fail' || r.status === 'error');
  if (bad.length > 0) {
    lines.push('', '## Failures', '');
    for (const r of bad) {
      lines.push(`### ${r.c.id}`, '', `Question: ${r.c.question}`, '');
      lines.push(`Why: ${r.detail}`, '');
      const t = r.turn?.answer.text ?? '';
      lines.push(
        'Answer:',
        '',
        ...(t === ''
          ? ['(empty)']
          : t
              .slice(0, 700)
              .split('\n')
              .map((x) => `> ${x}`)),
      );
      if ((r.turn?.notices.length ?? 0) > 0)
        lines.push('', `Notices: ${r.turn?.notices.join(', ')}`);
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}

function why(v: Verdict): string {
  const parts: string[] = [];
  if (!v.languageOk) parts.push('answer is not in the expected language/script');
  if (v.linksMissing.length > 0) parts.push(`missing link(s): ${v.linksMissing.join(', ')}`);
  if (v.wordsMissing.length > 0) parts.push(`missing word(s): ${v.wordsMissing.join(', ')}`);
  if (v.anyMissing) parts.push('none of the expected words appear');
  if (v.forbiddenHits.length > 0)
    parts.push(`forbidden content present: ${v.forbiddenHits.join(', ')}`);
  return parts.join('; ') || 'empty answer';
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const all = loadCases();
  const problems = validateCases(all);
  if (problems.length > 0) {
    console.error(`Case files are not valid:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  if (args.dry) {
    const by = (f: (c: EvalCase) => string) =>
      Object.entries(
        all.reduce<Record<string, number>>((m, c) => ({ ...m, [f(c)]: (m[f(c)] ?? 0) + 1 }), {}),
      )
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
    console.info(
      `OK: ${all.length} cases valid. ${by((c) => c.audience)} | ${by((c) => c.language)} | ${by((c) => c.kind)}`,
    );
    return;
  }

  let cases = all.filter(
    (c) =>
      (args.audience === null || c.audience === args.audience) &&
      (args.lang === null || c.language === args.lang) &&
      (args.kind === null || c.kind === args.kind) &&
      (args.only === null || args.only.includes(c.id)),
  );
  if (args.sample !== null) cases = pickSample(cases, args.sample);
  if (cases.length === 0) throw new Error('No case matches the filters.');
  if (cases.length > 10 && !args.all)
    throw new Error(`${cases.length} cases would be asked (real spend). Narrow it, or pass --all.`);

  const tokens = new Map<EvalAudience, string | null>();
  for (const aud of new Set(cases.map((c) => c.audience)))
    tokens.set(aud, await login(args.target, aud));
  const staffToken =
    tokens.get('staff') ?? (credentials('staff') ? await login(args.target, 'staff') : null);
  const before = staffToken === null ? null : await billedToDate(args.target, staffToken);

  const startedAt = new Date().toISOString();
  const results: Result[] = [];
  for (const c of cases) {
    const token = tokens.get(c.audience) ?? null;
    if (token === null) {
      results.push({
        c,
        status: 'skipped',
        verdict: null,
        turn: null,
        detail: 'no login for this audience',
        ms: 0,
      });
      continue;
    }
    const t0 = Date.now();
    try {
      const turn = await ask(args.target, c.audience, token, c.question);
      const verdict = scoreAnswer(c, turn.answer);
      results.push({
        c,
        status: verdict.pass ? 'pass' : 'fail',
        verdict,
        turn,
        detail: verdict.pass ? '' : why(verdict),
        ms: Date.now() - t0,
      });
    } catch (e) {
      results.push({
        c,
        status: 'error',
        verdict: null,
        turn: null,
        detail: e instanceof Error ? e.message : String(e),
        ms: Date.now() - t0,
      });
    }
    console.info(`${c.id}: ${results[results.length - 1]?.status}`);
    await sleep(4_000); // the send endpoint allows 20 a minute
  }

  const after = staffToken === null ? null : await billedToDate(args.target, staffToken);
  const costUsd = before !== null && after !== null ? after - before : null;
  const out = args.out ?? join(__dirname, `../eval/reports/${startedAt.replace(/[:.]/g, '-')}.md`);
  if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderReport(results, { target: args.target, startedAt, costUsd }));
  console.info(`report: ${out}`);
  if (results.some((r) => r.status === 'fail' || r.status === 'error')) process.exitCode = 2;
}

// Only when run as a script, never when the spec imports the helpers above.
if (/assistant-eval\.[tj]s$/.test(process.argv[1] ?? '')) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
