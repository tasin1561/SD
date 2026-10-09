/**
 * A row that navigates on click must ALSO carry a real link.
 *
 * `Tr`'s `onActivate` is a pointer convenience — its own docblock says
 * "ON TOP of the real link in the primary cell, which stays the keyboard
 * and screen-reader path". Where that link is missing the row is
 * reachable by mouse and by nothing else: no Tab, no screen reader, no
 * middle-click to a new tab. It looks and behaves perfectly for whoever
 * is testing with a mouse, which is why three lists shipped that way
 * (seller tickets among them) and why only a
 * scan finds them.
 *
 * It is a SCAN rather than a render test because the defect is the
 * absence of something, across every list in the app, and a render test
 * only ever covers the lists somebody remembered to write one for.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.join(__dirname, '..');

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules' && name !== 'tests') tsxFiles(full, out);
    } else if (name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** Every `<Tr onActivate={() => router.push(`…`)}>` and its row's markup. */
function rowsThatNavigate(src: string): { target: string; row: string }[] {
  const found: { target: string; row: string }[] = [];
  const re = /<Tr\b[^>]*onActivate=\{\(\)\s*=>\s*router\.push\(`([^`]+)`\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    // Start AFTER the opening tag. The `<Tr>` carries the destination in
    // its own `onActivate`, so a row measured from `m.index` always
    // "contains" the target and the check passes on markup with no link
    // at all — which it did, silently, on the first run. Proven by
    // reverting one row and watching it fail.
    // Past the whole match, so the `>` of the `=>` arrow inside
    // `onActivate` is not mistaken for the end of the opening tag. That
    // one cost two wrong results in a row: first the check passed on
    // markup with no link, then it still passed after the tag-end was
    // "fixed" to a point still inside the arrow.
    const openEnd = src.indexOf('>', m.index + m[0].length);
    const body = src.slice(openEnd + 1, openEnd + 3_000);
    const end = body.indexOf('</Tr>');
    found.push({ target: m[1] ?? '', row: end === -1 ? body : body.slice(0, end) });
  }
  return found;
}

describe('a row that navigates carries a link', () => {
  it('every router.push row has an <a> to the same place', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(SRC)) {
      const src = readFileSync(file, 'utf8');
      for (const { target, row } of rowsThatNavigate(src)) {
        // The whole row, not only its first cell: several lists lead with
        // a thumbnail and put the link in the second column, which a
        // first-cell check reports as broken when it is not.
        const base = (target.split('${')[0] ?? '').replace(/`/g, '');
        const linked = /<(Link|TextLink)\b/.test(row) && row.includes(base);
        if (!linked) offenders.push(`${path.relative(SRC, file)} → ${target}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
