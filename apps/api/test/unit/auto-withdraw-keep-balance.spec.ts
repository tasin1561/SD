import { Prisma } from '@skydrop/db';

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

/**
 * A seller may keep MORE in the wallet than we require, never less.
 *
 * Ours is security against an unpaid delivery fee; theirs is a working
 * float carried between sweeps. Before this, the sweep took everything
 * down to our line and a seller had no way to say otherwise.
 */
describe('auto-withdrawal keep-balance arithmetic', () => {
  /**
   * What the sweep asks for. `withdrawableBalance` has already taken
   * OUR floor out (WAL-3) — it is one number with three callers and has
   * to keep meaning one thing — so only the EXCESS over it is
   * subtracted here. Taking the whole keep figure would remove our
   * minimum twice and quietly halve what a seller can sweep.
   */
  function sweepAmount(guardAllows: string, keep: string, ourFloor: string): string {
    const extra = D(keep).sub(D(ourFloor));
    const available = extra.greaterThan(0) ? D(guardAllows).sub(extra) : D(guardAllows);
    return available.toFixed(2);
  }

  it('subtracts only the excess over our floor, never the floor twice', () => {
    // Balance 10,000, our floor 1,000 → guard allows 9,000.
    // Seller keeps 3,000 → 2,000 more than ours → sweep takes 7,000,
    // leaving exactly the 3,000 they asked for.
    expect(sweepAmount('9000.00', '3000', '1000')).toBe('7000.00');
  });

  it('changes nothing when the seller keeps exactly our minimum', () => {
    expect(sweepAmount('9000.00', '1000', '1000')).toBe('9000.00');
  });

  it('changes nothing when the seller has set no float at all', () => {
    expect(sweepAmount('9000.00', '0', '0')).toBe('9000.00');
  });

  it('never adds back when the stored value sits below our floor', () => {
    // The write guard refuses this, but a floor RAISED after the fact
    // leaves a stored value underneath it. Subtracting a negative would
    // sweep more than the guard allows and be refused by it.
    expect(sweepAmount('9000.00', '500', '1000')).toBe('9000.00');
  });

  it('can take the sweepable amount to zero, which is a normal quiet day', () => {
    expect(sweepAmount('2000.00', '3000', '1000')).toBe('0.00');
  });

  /** The write bound: theirs may sit above ours, never below. */
  function accepts(keep: string, ourFloor: string): boolean {
    return !D(keep).lessThan(D(ourFloor));
  }

  it('refuses a float under our minimum — that is not the seller’s to lower', () => {
    expect(accepts('500', '1000')).toBe(false);
    expect(accepts('1000', '1000')).toBe(true);
    expect(accepts('5000', '1000')).toBe(true);
  });
});
