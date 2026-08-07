import {
  INITIALS_PATTERN,
  generateSellerInitials,
  preferredInitials,
} from '../../src/modules/seller-auth/util/seller-initials';

/**
 * The seller short code.
 *
 * The collision cases are the ones that matter. A three-character code
 * WILL collide — "Menev Store" and "Modern Stationery" both want MSt —
 * and a code that identifies two companies is worse than no code,
 * because it fails at the moment it is being trusted: on a tote, on a
 * manifest, read down a phone line.
 */

const never = async (): Promise<boolean> => false;
const taken =
  (...used: string[]) =>
  async (c: string): Promise<boolean> =>
    used.includes(c);

describe('preferredInitials', () => {
  it('two words: first letter, then two of the next', () => {
    expect(preferredInitials('Menev Store')).toBe('MSt');
  });

  it('three or more words: one letter each', () => {
    expect(preferredInitials('QA Test Traders')).toBe('QTT');
    expect(preferredInitials('Ace Blue Cargo Limited')).toBe('ABC');
  });

  it('one word: the first three letters', () => {
    expect(preferredInitials('Skydrop')).toBe('Sky');
  });

  it('capitalises what starts a word and lowercases what does not', () => {
    // This is what makes it read as M + St rather than a chopped MST.
    expect(preferredInitials('menev store')).toBe('MSt');
    expect(preferredInitials('MENEV STORE')).toBe('MSt');
  });

  it('ignores punctuation, digits and extra spacing', () => {
    expect(preferredInitials('  Menev   Store!!  ')).toBe('MSt');
    expect(preferredInitials('7-Eleven')).toBe('Ele');
    expect(preferredInitials('A.B.C. Traders')).toBe('ABC');
  });

  it('folds accents rather than dropping the letter', () => {
    expect(preferredInitials('Café Noir')).toBe('CNo');
  });

  it('copes with a one-letter second word', () => {
    expect(preferredInitials('M S')).toBe('MS');
  });

  it('returns empty for a name with no letters, rather than guessing', () => {
    expect(preferredInitials('12345')).toBe('');
    expect(preferredInitials('   ')).toBe('');
  });
});

describe('generateSellerInitials — collisions', () => {
  it('takes the natural code when it is free', async () => {
    await expect(generateSellerInitials('Menev Store', never)).resolves.toBe('MSt');
  });

  it('falls to a later letter of the SAME name before any digit', async () => {
    // MSt taken → MSo, still recognisably "Menev Store".
    await expect(generateSellerInitials('Menev Store', taken('MSt'))).resolves.toBe('MSo');
  });

  it('walks further into the word as codes are used up', async () => {
    await expect(generateSellerInitials('Menev Store', taken('MSt', 'MSo'))).resolves.toBe('MSr');
  });

  it('only reaches a numeric tail when the name is exhausted', async () => {
    const all = taken('MSt', 'MSo', 'MSr', 'MSe');
    await expect(generateSellerInitials('Menev Store', all)).resolves.toBe('MS2');
  });

  it('separates two companies that want the same code', async () => {
    const a = await generateSellerInitials('Menev Store', never);
    const b = await generateSellerInitials('Modern Stationery', taken(a));
    expect(a).toBe('MSt');
    expect(b).not.toBe(a);
    expect(b).toBe('MSa');
  });

  it('throws rather than returning a duplicate it cannot avoid', async () => {
    await expect(generateSellerInitials('12345', never)).rejects.toThrow(/Could not derive/);
  });

  it('every generated code satisfies the pattern staff edits are held to', async () => {
    for (const name of ['Menev Store', 'QA Test Traders', 'Skydrop', 'Café Noir', 'M S']) {
      const code = await generateSellerInitials(name, never);
      expect(code).toMatch(INITIALS_PATTERN);
    }
  });
});
