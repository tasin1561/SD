import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every project class name a component writes is defined in some CSS.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * A misspelled class name is invisible to every gate we have. Typecheck
 * does not read CSS. Lint does not know which names are real. A
 * behavioural test asserts the WORDS on the screen, and the words are
 * there — unstyled. So the element renders with no border, no colour and
 * no spacing, in the middle of a page that otherwise looks right, and
 * the only way to find out is for somebody to look at it.
 *
 * It was found exactly that way: `bin-line-picker.tsx` shipped a
 * `className="stk-hint"` in its first cut (the real class is
 * `stk-note`), its own spec passed on the text, and the truncation
 * warning rendered as bare body copy.
 *
 * ── WHY IT STRIPS COMMENTS FIRST ─────────────────────────────────────
 * The scan that found this ALSO flagged the comment explaining the fix,
 * because `className="stk-hint"` inside a sentence about
 * `className="stk-hint"` is the same bytes. That is the lesson this
 * codebase already paid for once: a spec asserting on a docblock passed
 * while testing nothing (RBAC-1 / `@SellerRoles`). Prose about a rule
 * reads exactly like the rule to a regex, so the prose goes first.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────
 * Only OUR prefixes. Tailwind utilities are generated and checking them
 * would mean reimplementing Tailwind; a `sk-`/`stk-`/`wh-` name is one
 * somebody wrote by hand, which is the only kind that can be a typo.
 */

/** Prefixes that mean "a class one of us declared", not a Tailwind utility. */
const PROJECT_PREFIX = /^(stk|wh|sk|bin|ph|mi)-/;

const CSS_ROOTS = ['apps/admin/src', 'packages/ui/src'];
const TSX_ROOT = 'apps/admin/src';
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      walk(full, ext, out);
    } else if (name.endsWith(ext)) {
      out.push(full);
    }
  }
  return out;
}

/** Comments out, so a sentence about a class is not read as a use of one. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function definedClasses(): ReadonlySet<string> {
  const defined = new Set<string>();
  for (const root of CSS_ROOTS) {
    for (const file of walk(join(REPO_ROOT, root), '.css')) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\.([a-zA-Z][\w-]*)/g)) {
        const name = m[1];
        if (name !== undefined) defined.add(name);
      }
    }
  }
  return defined;
}

function usedProjectClasses(): ReadonlyMap<string, string> {
  // name → the first file that writes it, so a failure names where to look.
  const used = new Map<string, string>();
  for (const file of walk(join(REPO_ROOT, TSX_ROOT), '.tsx')) {
    if (file.includes(`${join('src', 'tests')}`)) continue;
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      for (const token of (m[1] ?? m[2] ?? '').split(/\s+/)) {
        if (token === '' || token.includes('$') || token.includes('{')) continue;
        if (!PROJECT_PREFIX.test(token)) continue;
        if (!used.has(token)) used.set(token, file.slice(REPO_ROOT.length + 1));
      }
    }
  }
  return used;
}

describe('admin class names — a hand-written class is declared somewhere', () => {
  it('finds project classes to check at all (the scan is not silently empty)', () => {
    // A guard whose finder stops working passes for ever. 'stk-note' and
    // 'wh-note' are both real and both in use; if neither is found, the
    // walk or the regex has broken, not the estate.
    const used = usedProjectClasses();
    expect(used.size).toBeGreaterThan(50);
    expect([...used.keys()]).toContain('stk-note');
  });

  it('every one of them is defined in CSS', () => {
    const defined = definedClasses();
    const missing = [...usedProjectClasses()]
      .filter(([name]) => !defined.has(name))
      .map(([name, file]) => `${name}  (${file})`);
    expect(missing).toEqual([]);
  });
});
