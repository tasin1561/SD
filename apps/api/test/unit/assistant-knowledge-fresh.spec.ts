import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  REGENERATE_COMMAND,
  render,
  staleFiles,
} from '../../src/modules/assistant/knowledge/generator';
import { readMessageExpr } from '../../src/modules/assistant/knowledge/generator/scan-error-codes';

/**
 * The assistant's committed knowledge indexes must match the repository.
 * A new `code: 'X'`, a new (authed) page, a changed page-access table or
 * message catalogue, a changed settings guide or invariant doc makes the
 * committed output stale; this spec RE-RUNS the generators in memory and
 * fails until the developer regenerates and commits.
 */
const root = join(__dirname, '../../../..');
const dir = join(__dirname, '../../src/modules/assistant/knowledge/generated');

describe('the committed knowledge indexes are fresh', () => {
  const rendered = render(root);

  it('are exactly what the generators produce now', () => {
    const stale = staleFiles(rendered, dir);
    if (stale.length > 0) {
      throw new Error(
        `The assistant knowledge index is out of date (${stale.join(', ')}).\n` +
          `Something it indexes changed: an error code, a page, a message catalogue, the settings guide or a docs/invariants file.\n` +
          `Run:  ${REGENERATE_COMMAND}\nthen commit the files under apps/api/src/modules/assistant/knowledge/generated/.`,
      );
    }
    expect(stale).toEqual([]);
  });

  it('the detector fires when a committed index is edited (so a pass above means something)', () => {
    const copy = mkdtempSync(join(tmpdir(), 'assistant-generated-'));
    cpSync(dir, copy, { recursive: true });
    expect(staleFiles(rendered, copy)).toEqual([]);

    const file = join(copy, 'error-codes.ts');
    writeFileSync(file, readFileSync(file, 'utf8').replace('ORDER_NOT_FOUND', 'ORDER_NOT_FOUNDX'));
    expect(staleFiles(rendered, copy)).toEqual(['error-codes.ts']);

    const pages = join(copy, 'page-map.ts');
    writeFileSync(pages, readFileSync(pages, 'utf8').replace('"/orders"', '"/orderz"'));
    expect(staleFiles(rendered, copy).sort()).toEqual(['error-codes.ts', 'page-map.ts']);
  });

  it('a file that is missing counts as stale', () => {
    const copy = mkdtempSync(join(tmpdir(), 'assistant-generated-empty-'));
    expect(staleFiles(rendered, copy).sort()).toEqual([
      'error-codes.ts',
      'help-text.ts',
      'page-map.ts',
    ]);
  });
});

describe('the generators read what they claim to', () => {
  const rendered = render(root);

  it('indexes every distinct error code thrown in the API (792 at the time of writing, never fewer)', () => {
    const n = (rendered['error-codes.ts']!.match(/^ {2}\["/gm) ?? []).length;
    expect(n).toBeGreaterThanOrEqual(792);
  });

  it('keeps ${…} placeholders as {…} and joins concatenated message pieces', () => {
    const src =
      "message: 'Label ' + `${code} was replaced for ${a ? `x ${b}` : ''}.` + ' Bin it.',";
    expect(readMessageExpr(src, 'message:'.length)).toBe('Label {…} was replaced for {…}. Bin it.');
    expect(readMessageExpr('message: someVariable,', 8)).toBeNull();
  });

  it('every console contributes pages with titles (derived or from the nav)', () => {
    const pages = rendered['page-map.ts']!;
    for (const c of ['ADMIN', 'SELLER', 'RESELLER', 'ASSOCIATE']) {
      expect(pages).toContain(`export const PAGES_${c}`);
    }
    expect(pages).toContain('["/warehouse/pack",');
    expect(pages).toContain('"warehouse.pack"');
  });
});
