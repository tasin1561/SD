import { describe, expect, it } from 'vitest';
import { finalizeConsequence } from '../app/(authed)/warehouse/rto/_components/rto-station';

/**
 * The sentence in the finalise confirm — the last thing read before an
 * act that moves stock and cannot be undone.
 *
 * The defect this pins was found by filming it (K2, 2026-10-01): the
 * commonest split of all, one unit good and one damaged, rendered as
 * "1 unit go back in stock, 1 unit are kept aside damaged and 0 units
 * are written off". One template was used for every number, so the noun
 * was pluralised and the verb was not.
 */
describe('finalizeConsequence', () => {
  it('agrees the verb with a single unit', () => {
    const said = finalizeConsequence({ restock: 1, hold: 1, writeOff: 0 });
    expect(said).toContain('1 unit goes back in stock');
    expect(said).toContain('1 unit is kept aside damaged');
    expect(said).not.toContain('unit go back');
    expect(said).not.toContain('unit are kept');
  });

  it('agrees the verb with several units', () => {
    const said = finalizeConsequence({ restock: 2, hold: 0, writeOff: 3 });
    expect(said).toContain('2 units go back in stock');
    expect(said).toContain('3 units are written off');
  });

  it('leaves out an outcome nothing is going to', () => {
    const said = finalizeConsequence({ restock: 1, hold: 1, writeOff: 0 });
    expect(said).not.toContain('0 unit');
    expect(said).toBe(
      '1 unit goes back in stock and 1 unit is kept aside damaged — stock moves now and this cannot be undone.',
    );
  });

  it('lists all three when all three have something in them', () => {
    expect(finalizeConsequence({ restock: 2, hold: 1, writeOff: 1 })).toBe(
      '2 units go back in stock, 1 unit is kept aside damaged and 1 unit is written off — ' +
        'stock moves now and this cannot be undone.',
    );
  });

  it('still says the warning when only one outcome has units', () => {
    expect(finalizeConsequence({ restock: 4, hold: 0, writeOff: 0 })).toBe(
      '4 units go back in stock — stock moves now and this cannot be undone.',
    );
  });

  /**
   * Every unit marked "decide later". The server refuses this and the
   * dialog's own note says so — but an EMPTY consequence under a title
   * asking "Finalize this return?" is the worst of both.
   */
  it('says plainly when nothing is ready to move', () => {
    expect(finalizeConsequence({ restock: 0, hold: 0, writeOff: 0 })).toBe(
      'Nothing is ready to move — every unit is still waiting on a decision.',
    );
  });
});
