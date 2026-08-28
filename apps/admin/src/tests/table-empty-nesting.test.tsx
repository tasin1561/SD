import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `<TableEmpty>` is a ROW and must sit inside a `<TBody>`.
 *
 * It used to render its own `<tbody>`, which read as self-contained and
 * was therefore dropped inside one at nine of eleven call sites. A
 * `<tbody>` nested in a `<tbody>` is invalid: the browser's parser
 * un-nests it and React then hydrates against a DOM that no longer
 * matches what it rendered.
 *
 * That failure is invisible in a screenshot — the table looks right. It
 * surfaces only as a console hydration error, which is why it survived
 * across nine files until someone opened the page with the console open.
 * A behavioural test would not catch it either, so this reads the source.
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name === '.next') continue;
    if (statSync(p).isDirectory()) out.push(...walk(p));
    // Skip tests — this one names the component in a string and would
    // otherwise report itself.
    else if (p.endsWith('.tsx') && !p.endsWith('.test.tsx')) out.push(p);
  }
  return out;
}

/** Every app that consumes the shared table primitives. */
const ROOTS = [join(__dirname, '..'), join(__dirname, '../../../seller/src')];

describe('TableEmpty is a row, not a body', () => {
  it('never appears outside a <TBody>', () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      let files: string[];
      try {
        files = walk(root);
      } catch {
        continue; // the sibling app is not always present
      }
      for (const file of files) {
        const src = readFileSync(file, 'utf8');
        if (!src.includes('<TableEmpty')) continue;

        for (const m of src.matchAll(/<TableEmpty/g)) {
          const before = src.slice(0, m.index);
          const opens = (before.match(/<TBody[\s>]/g) ?? []).length;
          const closes = (before.match(/<\/TBody>/g) ?? []).length;
          if (opens <= closes) {
            offenders.push(file.replace(/.*\/(apps\/)/, '$1'));
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the component itself renders a <tr>, never a <tbody>', () => {
    // If this ever goes back to a body, the check above starts passing
    // for the wrong reason — every call site would then be wrong.
    const src = readFileSync(
      join(__dirname, '../../../../packages/ui/src/components/data-table.tsx'),
      'utf8',
    );
    const fn = src.slice(src.indexOf('export function TableEmpty'));
    // From the return statement to the end of the function — slicing on
    // the first `\n}` lands inside the prop type annotation instead.
    const body = fn.slice(fn.indexOf('return ('), fn.indexOf('\n}\n'));
    expect(body).toContain('<tr>');
    expect(body).not.toContain('<tbody>');
  });
});
