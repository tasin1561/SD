#!/usr/bin/env node
/**
 * The pre-commit gate.
 *
 * WHAT CHANGED (2026-10-28): it used to be
 *   gate:clean && typecheck && lint && format:check && test
 * — five phases over the WHOLE repo, chained with `&&`, which made it
 * both slower than it needed to be and worse at reporting. `&&` stops
 * at the first failure, so a lint error hid every type error behind it
 * and you learned about them one `pnpm gate` at a time.
 *
 * Now the phases run CONCURRENTLY and every one runs to the end. The
 * gate reports all of their failures together and exits non-zero if any
 * phase failed.
 *
 * SCOPE: by default only the packages affected by your changes, via
 * `turbo --affected`, which resolves the dependency graph — a
 * packages/db edit comes back as all twelve packages, a seller edit as
 * one. The full suite is CI's job, and CI remains the merge gate. See
 * the honest limits of that in CLAUDE.md under "Gate rules".
 *
 *   GATE_ALL=1     every package, ignoring the affected set. This is
 *                  the old whole-repo behaviour and what CI runs.
 *   GATE_SERIAL=1  one phase at a time. Still runs all of them. Reach
 *                  for it when a parallel run looks flaky — eight cores
 *                  shared between tsc, eslint and a test suite is how
 *                  a starved machine fakes a timeout.
 *   GATE_BASE=ref  what "affected" is measured against (default: main).
 */

import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const ALL = process.env.GATE_ALL === '1';
const SERIAL = process.env.GATE_SERIAL === '1';
const BASE = process.env.GATE_BASE || 'main';

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const git = (args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

/**
 * Changed files, for the format phase only.
 *
 * `git diff <base>` compares the base to the WORKING TREE, so one call
 * covers committed-but-unpushed work and uncommitted edits together.
 * Untracked files are added separately — prettier should see a new file
 * before it is staged, not after CI rejects it.
 *
 * This phase is deliberately file-based rather than
 * `turbo run format:check --affected`: prettier also owns the root
 * files that belong to no package at all — CLAUDE.md, the workflows,
 * turbo.json — and a package filter cannot see them.
 */
function changedFiles() {
  const tracked = git(['diff', '--name-only', '--diff-filter=d', BASE]);
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  return [...tracked.split('\n'), ...untracked.split('\n')].filter(Boolean);
}

/** Packages turbo considers affected, for the banner. */
function affectedPackages() {
  try {
    const out = execFileSync(
      'pnpm',
      ['exec', 'turbo', 'run', 'typecheck', '--affected', '--dry=json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 },
    );
    return JSON.parse(out).packages ?? [];
  } catch {
    return null;
  }
}

const SCOPE = ALL ? [] : ['--affected'];
// In parallel mode three heavy phases share the machine, so each one is
// capped rather than left at turbo's default of 10. Tests stay at 1
// whatever the mode: a jest suite and a vitest suite running at once on
// this box starve each other and fail in ways that look like flakes but
// are not.
// GATE_SERIAL means serial, so say so to turbo too — leaving the flag
// off gave it its DEFAULT of 10, which is the opposite of what the
// person reaching for that flag asked for.
// Stage 1 is tsc and eslint only, so it wants every core. The earlier
// cap of 3 was there to leave room for a concurrent test run; with
// tests moved to their own stage there is nothing to leave room for,
// and the cap cost the large case 436s of typecheck throughput.
const FAN = SERIAL ? ['--concurrency=1'] : ['--concurrency=10'];

/**
 * TWO STAGES, AND THE REASON IS A BUG THIS SCRIPT ALREADY HAD.
 *
 * `typecheck`, `lint` and `test` each declare `dependsOn: ["^build"]`,
 * and `build` writes `dist/**`, `.next/**`, `out/**`. Turbo dedupes
 * that dependency inside ONE invocation. It cannot dedupe it across
 * three — so the first version of this file, which ran the three as
 * three concurrent `turbo run` processes, had all three independently
 * building the same packages into the same directories at the same
 * time.
 *
 * It did not fail loudly. It produced, on a packages/db change:
 *   `Module '"@prisma/client"' has no exported member 'PrismaClient'`
 * — a half-written generated client — plus two test failures that
 * appear in no serial run (`AppModule › resolves every provider` and a
 * Shiprocket session spec). Three failures where the serial run had
 * one. Had I reported that benchmark without reading the logs, the
 * conclusion on offer was "the parallel gate is flaky", which is the
 * wrong lesson about the right observation.
 *
 * So: stage 1 builds, ONCE, and runs the one phase that touches no
 * build output. Stage 2 is read-only against `dist/` and may fan out.
 */
const stage1 = [
  {
    // typecheck + lint in ONE invocation, NOT a `build` pass in front
    // of them: `turbo run build --affected` builds the affected
    // packages THEMSELVES, and an app's own Next bundle is 144s that
    // neither task has any use for. What they declare is `^build` —
    // their DEPENDENCIES — which turbo resolves once and shares when
    // both tasks are named in the same run.
    //
    // Both are tsc/eslint, so they parallelise cleanly and want all
    // the cores there are. Tests are deliberately NOT here; see below.
    name: 'typecheck+lint',
    cmd: 'pnpm',
    args: [
      'exec',
      'turbo',
      'run',
      'typecheck',
      'lint',
      ...SCOPE,
      ...FAN,
      // Every task runs to the end; a failing typecheck does not
      // cancel the lint that would have told you something else.
      '--continue=always',
      '--output-logs=errors-only',
    ],
  },
];

/**
 * TESTS GET THE MACHINE TO THEMSELVES, and this is measured, not
 * cautious.
 *
 * Folding `test` into the invocation above and letting turbo schedule
 * all three took the api jest suite from 126s to 378s on a
 * packages/db change — three times slower — and brought back two
 * failures that appear in no serial run (`AppModule › resolves every
 * provider` and a Shiprocket session spec). Jest forks a worker per
 * core and so does tsc; on eight cores they do not share, they
 * trample. The whole-gate number was 1398s against the old gate's
 * 781s, so the "parallel" version was nearly twice as SLOW.
 *
 * The lesson generalises past the jest-vs-vitest note in the project
 * memory: it is jest against anything CPU-hungry. So stage 2 runs the
 * suites with nothing else of weight beside them — only the two short
 * always-on/guards phases, which are seconds, not minutes.
 */
const phases = [
  {
    name: 'test',
    cmd: 'pnpm',
    args: [
      'exec',
      'turbo',
      'run',
      'test',
      ...SCOPE,
      // ALWAYS 1. `^build` is already satisfied from stage 1, so this
      // writes nothing and only reads.
      '--concurrency=1',
      '--continue=always',
      '--output-logs=errors-only',
    ],
  },
  {
    // NEVER FILTERED, whatever the change looked like.
    //
    // app-module-boots is one test, a few seconds, and the only thing
    // that proves the app starts — the cheapest value-per-second in the
    // repository and the easiest to lose to a path filter. The two
    // *-threading specs read SOURCES rather than behaviour, so they
    // catch what a behavioural test cannot see. All three live in
    // @skydrop/api, which an affected run on a frontend change would
    // not select. 9 seconds to never have to think about it.
    name: 'always-on',
    cmd: 'pnpm',
    args: [
      '--filter',
      '@skydrop/api',
      'exec',
      'jest',
      '--config',
      'jest.config.ts',
      '--silent',
      'test/unit/app-module-boots.spec.ts',
      'test/unit/delhivery-actor-threading.spec.ts',
      'test/unit/delhivery-account-threading.spec.ts',
    ],
  },
];

const files = changedFiles();

/**
 * THE HOLE A PACKAGE FILTER LEAVES, and the phase that closes it.
 *
 * Some specs read another package's SOURCE rather than calling its
 * code: `apps/admin/src/tests/auth-console-copies.test.ts` reads
 * seller's and reseller's login pages, `apps/api`'s track-csp spec
 * reads apps/track. Sixteen of them at the time of writing.
 *
 * They are owned by one package and guard another, so `--affected` is
 * blind to them in exactly the direction that matters: edit a reseller
 * layout and the spec that checks all three layouts agree lives in
 * seller, is not selected, and the gate goes green on the one thing it
 * existed to catch. That is the 2026-08-05 failure shape — a filter
 * reporting success on a suite it never executed — reappearing in a
 * filter nobody typed by hand.
 *
 * So: find the specs that mention an app the change touched, and run
 * THOSE FILES in their owning package. Discovered by reading the tree,
 * never a hardcoded list — a list would rot the first time someone
 * wrote spec seventeen, and rot silently.
 */
const APP_DIRS = ['admin', 'seller', 'track', 'reseller', 'associate', 'marketing'];
const RUNNER = {
  // --runTestsByPath: jest reads positional args as REGEXES otherwise,
  // and a spec path is full of `.` — which is how a targeted run
  // quietly becomes a broad one.
  '@skydrop/api': ['exec', 'jest', '--config', 'jest.config.ts', '--silent', '--runTestsByPath'],
};
const DEFAULT_RUNNER = ['exec', 'vitest', 'run'];

function crossPackageSpecs() {
  const touched = new Set(
    files.map((f) => /^apps\/([^/]+)\//.exec(f)?.[1]).filter((a) => a && APP_DIRS.includes(a)),
  );
  if (touched.size === 0) return [];
  let listing = '';
  // A SOURCE-TREE path, and nothing looser. Two forms, because the
  // specs use both: `apps/reseller/…` and the relative
  // `../../../reseller/src/…` that the layout-nesting spec reaches its
  // siblings with.
  //
  // The looser pattern this replaces — the app name between any two
  // separators — matched `'seller/orders'`, which is an API ROUTE, and
  // pulled 16 api specs into a seller change including three
  // Shiprocket ones. Requiring `apps/<name>/` or `<name>/src` is what
  // separates "reads that app's source" from "mentions that app's URL"
  // and from prose in a comment.
  const names = [...touched].join('|');
  try {
    listing = execFileSync(
      'grep',
      [
        '-rlE',
        `(apps/(${names})/|/(${names})/src)`,
        '--include=*.test.ts',
        '--include=*.test.tsx',
        '--include=*.spec.ts',
        'apps',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    return []; // grep exits 1 on no match
  }
  const byPkg = new Map();
  for (const file of listing.split('\n').filter(Boolean)) {
    const owner = /^apps\/([^/]+)\//.exec(file)?.[1];
    // Owned by an app the change already selected: its own suite runs.
    if (!owner || touched.has(owner)) continue;
    const pkg = `@skydrop/${owner}`;
    if (!byPkg.has(pkg)) byPkg.set(pkg, []);
    // Paths are package-relative for the runner.
    byPkg.get(pkg).push(file.slice(`apps/${owner}/`.length));
  }
  return [...byPkg].map(([pkg, specs]) => ({
    name: `guards:${pkg.replace('@skydrop/', '')}`,
    cmd: 'pnpm',
    args: ['--filter', pkg, ...(RUNNER[pkg] ?? DEFAULT_RUNNER), ...specs],
  }));
}

if (!ALL) phases.push(...crossPackageSpecs());

const prettierTargets = ALL ? ['.'] : files;
if (prettierTargets.length > 0) {
  // Stage 1: prettier only READS source files, so it races nothing and
  // may as well finish while turbo is still starting up.
  stage1.push({
    name: 'format',
    cmd: 'pnpm',
    // --ignore-unknown: the changed set is whatever you touched, and
    // prettier ERRORS rather than skips on a file it has no parser for
    // (scripts/deploy.sh is the one that proves it).
    args: ['exec', 'prettier', '--check', '--ignore-unknown', ...prettierTargets],
  });
}

function run(phase) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(phase.cmd, phase.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1' },
    });
    let out = '';
    const take = (c) => {
      out += c;
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('close', (code) => {
      const ms = Date.now() - started;
      process.stdout.write(
        `  ${code === 0 ? C.green('✓') : C.red('✗')} ${phase.name.padEnd(10)} ${C.dim(
          `${(ms / 1000).toFixed(1)}s`,
        )}\n`,
      );
      resolve({ ...phase, code, out, ms });
    });
    child.on('error', (err) => {
      resolve({ ...phase, code: 1, out: String(err), ms: Date.now() - started });
    });
  });
}

const started = Date.now();

// The stale-cache trap: an incremental tsc reports clean on files it
// never looked at, because a .tsbuildinfo from a previous shape of the
// tree told it they were unchanged. Deleting them is what makes the
// typecheck phase mean anything. `-delete` and `-prune` do not combine,
// so this is a -path exclusion.
execFileSync(
  'find',
  ['apps', 'packages', '-name', '*.tsbuildinfo', '-not', '-path', '*/node_modules/*', '-delete'],
  { stdio: 'ignore' },
);

const pkgs = ALL ? null : affectedPackages();
console.log(
  C.bold('\ngate') +
    ` — ${ALL ? 'EVERY package' : `affected only (base: ${BASE})`}, ${
      SERIAL ? 'serial' : 'parallel'
    }`,
);
if (pkgs !== null) {
  console.log(
    C.dim(`  scope: ${pkgs.length ? pkgs.join(' ') : '(no package affected)'}`) +
      C.dim(`\n  files: ${files.length} changed`),
  );
}
console.log(C.dim('  CI runs the full suite and remains the merge gate.\n'));

const results = [];

// Stage 1 — the only writer of build output. Stage 2 fans out over a
// dist/ that nothing is still writing to.
if (SERIAL) {
  for (const p of stage1) results.push(await run(p));
} else {
  results.push(...(await Promise.all(stage1.map(run))));
}

// Stage 2 runs even when stage 1 failed. Stopping here would be the
// `&&` chain again, one layer up: the whole point is that you learn
// everything that is wrong in one run. The summary flags the ordering
// so a cascade is not mistaken for four separate problems.
const stage1Failed = results.some((r) => r.code !== 0);

if (SERIAL) {
  for (const p of phases) results.push(await run(p));
} else {
  results.push(...(await Promise.all(phases.map(run))));
}

const failed = results.filter((r) => r.code !== 0);

// EVERY failure, not the first. The old `&&` chain stopped at one and
// hid the rest, which is how a single `pnpm gate` turned into four.
for (const f of failed) {
  console.log(`\n${C.red('─'.repeat(60))}\n${C.red(C.bold(`FAILED: ${f.name}`))}\n`);
  console.log(f.out.trimEnd());
}

const total = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `\n${C.bold('gate')} ${failed.length === 0 ? C.green('PASS') : C.red(`FAIL (${failed.map((f) => f.name).join(', ')})`)} ` +
    C.dim(`— ${total}s, ${results.length} phases`),
);
if (stage1Failed && failed.length > 1) {
  console.log(
    C.dim(
      '  NOTE: a stage-1 phase failed, so later phases may be reporting its consequences\n' +
        '  rather than separate problems. Fix the stage-1 failure first, then re-run.',
    ),
  );
}
if (!ALL) {
  console.log(
    C.dim('  Scoped to the affected packages. Run GATE_ALL=1 pnpm gate for the whole repo.'),
  );
}
process.exit(failed.length === 0 ? 0 : 1);
