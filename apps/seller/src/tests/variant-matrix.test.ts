import { describe, expect, it } from 'vitest';
import {
  buildRows,
  type ProductOption,
} from '@/app/(authed)/products/new/_components/new-product-form';

/**
 * Real catalogues are RAGGED. A shoe runs Red 38-42, Blue 40-43 and
 * Yellow only 37/40/42 — twelve real pairs, not the twenty-one a
 * cartesian of three colours and seven sizes would offer.
 *
 * These are behavioural, not source-text: the generator is the piece
 * that decides what gets created, and asserting on its OUTPUT is the
 * only way to know the counts are right.
 */

const opt = (
  name: string,
  values: string[],
  perParent: ProductOption['perParent'] = null,
): ProductOption => ({
  name,
  values,
  perParent,
});

describe('buildRows — ragged sizes per colour', () => {
  const colours = opt('Colour', ['Red', 'Blue', 'Yellow']);
  const sizes = opt('Size', [], {
    Red: ['38', '39', '40', '41', '42'],
    Blue: ['40', '41', '42', '43'],
    Yellow: ['37', '40', '42'],
  });

  it('creates exactly the pairs that exist — twelve, not twenty-one', () => {
    const rows = buildRows('Runner Shoe', [colours, sizes]);
    expect(rows).toHaveLength(12);
  });

  it('gives each colour its own sizes and nothing else', () => {
    const rows = buildRows('Runner Shoe', [colours, sizes]);
    const byColour = (c: string): string[] =>
      rows.filter((r) => r.values['Colour'] === c).map((r) => r.values['Size'] ?? '');

    expect(byColour('Red')).toEqual(['38', '39', '40', '41', '42']);
    expect(byColour('Blue')).toEqual(['40', '41', '42', '43']);
    expect(byColour('Yellow')).toEqual(['37', '40', '42']);
    // The combinations a cartesian would have invented.
    expect(byColour('Blue')).not.toContain('38');
    expect(byColour('Yellow')).not.toContain('41');
  });

  it('records both axes structurally on every row', () => {
    const rows = buildRows('Runner Shoe', [colours, sizes]);
    for (const r of rows) {
      expect(Object.keys(r.values).sort()).toEqual(['Colour', 'Size']);
    }
  });

  it('suggests a distinct SKU per pair', () => {
    const skus = buildRows('Runner Shoe', [colours, sizes]).map((r) => r.suggestedSku);
    expect(new Set(skus).size).toBe(skus.length);
    expect(skus).toContain('RUNNER-RED-38');
  });

  it('drops a colour that stocks nothing, rather than inventing a blank size', () => {
    const withEmpty = opt('Size', [], {
      Red: ['38', '39'],
      Blue: [],
      Yellow: ['   '],
    });
    const rows = buildRows('Runner Shoe', [colours, withEmpty]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.values['Colour'])).toEqual(['Red', 'Red']);
  });
});

describe('buildRows — the plain cases still behave', () => {
  it('is a single unnamed row when no option is usable', () => {
    expect(buildRows('Runner Shoe', [])).toHaveLength(1);
    expect(buildRows('Runner Shoe', [opt('', [''])])).toHaveLength(1);
    // An option with a name but no values multiplies nothing.
    expect(buildRows('Runner Shoe', [opt('Colour', [])])).toHaveLength(1);
  });

  it('a shared second axis is a plain cartesian — 2 x 3 = 6', () => {
    const rows = buildRows('Runner Shoe', [
      opt('Colour', ['Red', 'Blue']),
      opt('Size', ['40', '41', '42']),
    ]);
    expect(rows).toHaveLength(6);
  });

  it('ignores anything past the second option — two is the ceiling', () => {
    // The UI stops offering "Add an option" at two, because only the
    // SECOND axis can hold a list per value of the first and a third has
    // no unambiguous place to sit. The generator matches that rather than
    // silently supporting a shape nobody can enter.
    const rows = buildRows('Runner Shoe', [
      opt('Colour', ['Red', 'Blue']),
      opt('Size', ['40', '41']),
      opt('Width', ['D', 'EE']),
    ]);
    expect(rows).toHaveLength(4);
  });

  it('trims whitespace and ignores blank values', () => {
    const rows = buildRows('Runner Shoe', [opt('Colour', [' Red ', '', '   ', 'Blue'])]);
    expect(rows.map((r) => r.values['Colour'])).toEqual(['Red', 'Blue']);
  });
});
