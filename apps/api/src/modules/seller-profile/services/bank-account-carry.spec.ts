import { carriesAccountForward, accountForDisplay } from './bank-account-carry';

/**
 * The rule three places depend on: the seller's profile, the admin
 * review queue, and approval itself. They must agree — a screen that
 * says "unchanged" while approval writes something else moves a payout
 * destination nobody read.
 */

const LIVE = { stored: 'CIPHER-A', masked: '••••4001', keyVersion: 1 };

describe('carriesAccountForward', () => {
  it('is true when the request holds the same ciphertext', () => {
    expect(carriesAccountForward({ ...LIVE }, LIVE)).toBe(true);
  });

  it('is true for the pre-2026-08-18 shape: right ciphertext, lost mask and key version', () => {
    // The exact row this was found on. The ciphertext survived the write
    // path; the other two did not.
    const legacy = { stored: 'CIPHER-A', masked: '', keyVersion: null };
    expect(carriesAccountForward(legacy, LIVE)).toBe(true);
    // And what it must SHOW is the live triple — revealing the legacy
    // one hands back the raw blob, because keyVersion null means
    // "already plaintext".
    expect(accountForDisplay(legacy, LIVE)).toEqual(LIVE);
  });

  it('is true when the request carries nothing — a blank is never a removal', () => {
    // Removal clears all six and writes through; it never reaches the
    // approval queue. So a blank here only means "not part of this edit".
    expect(carriesAccountForward({ stored: '', masked: '', keyVersion: null }, LIVE)).toBe(true);
    expect(carriesAccountForward({ stored: null, masked: null, keyVersion: null }, LIVE)).toBe(
      true,
    );
  });

  it('is FALSE when the ciphertext genuinely differs', () => {
    const moved = { stored: 'CIPHER-B', masked: '••••9999', keyVersion: 1 };
    expect(carriesAccountForward(moved, LIVE)).toBe(false);
    // A real change shows its OWN triple — that is the thing being approved.
    expect(accountForDisplay(moved, LIVE)).toEqual(moved);
  });

  it('does not mistake a same-looking mask for a same account', () => {
    // Two different numbers can share their last four digits. The
    // comparison is on ciphertext for exactly this reason.
    const different = { stored: 'CIPHER-B', masked: '••••4001', keyVersion: 1 };
    expect(carriesAccountForward(different, LIVE)).toBe(false);
  });
});
