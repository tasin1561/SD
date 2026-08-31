/**
 * A raw `<textarea>` or `<select>` renders with NO border, background
 * or padding, and looks like body text.
 *
 * The chrome lives in `inputBase` inside `@skydrop/ui`'s Input /
 * Textarea / Select. `.sd-field` — the class these call sites reached
 * for — only sets WIDTH and the touch font-size; it was never the
 * styling. So `<textarea className="sd-field">` is a control that
 * silently opts out of looking like one, and it shipped that way on the
 * seller's return dialog: an invisible box under a prose-styled
 * placeholder that read as a paragraph.
 *
 * Six controls across both apps were in that state, and four more
 * hand-rolled their own border — the FE-6 rule about never hardcoding
 * what the token system covers, arrived at from the other direction.
 *
 * Structural because nothing else can see it: the markup is valid, the
 * value binds, every component test passes, and only a person looking
 * at the screen notices there is no box.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/**
 * `<input>` is deliberately NOT checked. `type="file"`, `"checkbox"`
 * and `"radio"` are legitimately raw — the primitive styles a text box
 * and would be wrong on all three — so the rule would be more exception
 * than rule. Textarea and select have no such variants.
 */
// `$` matters as much as the rest: a multi-line JSX tag is written
// `<textarea` with NOTHING after it on that line, which is the exact
// shape this is meant to catch. Without the end-of-line alternative the
// guard passes on every real offender and fires only on one-liners —
// verified by reintroducing one and watching it stay green.
const RAW = /<(textarea|select)(\s|>|$)/;

function offenders(root: string): string[] {
  const found: string[] = [];
  for (const file of walk(root)) {
    // Comments FIRST, whole-file. Prose explains why something is a
    // `<select>`, and those explanations wrap across lines, so a
    // per-line "starts with *" test misses the continuations. A guard
    // that fires on documentation teaches people to stop writing it.
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const line of src.split('\n')) {
      // The primitives themselves render the raw element — that is
      // their job. Only call sites are in scope, and this test only
      // ever runs against an app's src.
      if (RAW.test(line)) found.push(`${file.replace(/.*\/src\//, 'src/')}: ${line.trim()}`);
    }
  }
  return found;
}

describe('form controls come from @skydrop/ui, not raw elements', () => {
  it('seller has no raw <textarea> or <select>', () => {
    expect(offenders(join(__dirname, '..'))).toEqual([]);
  });
});
