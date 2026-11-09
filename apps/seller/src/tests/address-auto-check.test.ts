import { describe, expect, it } from 'vitest';
import {
  AUTO_CHECK_PAUSE_MS,
  addressCheckKey,
  shouldAutoCheck,
  suggestedAddressLine1,
  suggestionIsWorthOffering,
  suggestionKeepsEverything,
  type AutoCheckInput,
} from '@/lib/address-auto-check';

/**
 * The order page checks an address without being asked. These are the
 * rules that decide how often a paid third party hears from a form
 * somebody is typing into, so each condition gets a test that fails if
 * it is dropped — the failure mode of losing one is not a wrong answer,
 * it is a quiet flood nobody notices until the vendor does.
 */

const READY: AutoCheckInput = {
  canCheck: true,
  addressLine2: 'Near City Hospital',
  busy: false,
  lastAsked: null,
  key: addressCheckKey('560001', 'cod', '12 MG Road, Near City Hospital'),
};

describe('shouldAutoCheck', () => {
  it('asks once the PIN and both lines are there', () => {
    expect(shouldAutoCheck(READY)).toBe(true);
  });

  it('does not ask before the form says there is enough to check', () => {
    expect(shouldAutoCheck({ ...READY, canCheck: false })).toBe(false);
  });

  it('waits for line 2, which canCheck alone does not require', () => {
    // The landmark is what lifts a verdict out of "no landmark". A
    // button somebody pressed may go without it; an unasked-for
    // question may not.
    expect(shouldAutoCheck({ ...READY, addressLine2: '' })).toBe(false);
    expect(shouldAutoCheck({ ...READY, addressLine2: '   ' })).toBe(false);
  });

  it('does not stack a second question on an unanswered one', () => {
    expect(shouldAutoCheck({ ...READY, busy: true })).toBe(false);
  });

  it('does not re-ask a question already asked', () => {
    // THE DEDUPE. Every render re-runs the effect, and most renders of
    // this form — a product added, a checkbox ticked — have nothing to
    // do with the address.
    expect(shouldAutoCheck({ ...READY, lastAsked: READY.key })).toBe(false);
  });

  it('asks again when the address actually changes', () => {
    const edited = addressCheckKey('560001', 'cod', '12 MG Road, Near City School');
    expect(shouldAutoCheck({ ...READY, lastAsked: READY.key, key: edited })).toBe(true);
  });

  it('asks again when the PIN changes under an unchanged address', () => {
    const moved = addressCheckKey('700128', 'cod', '12 MG Road, Near City Hospital');
    expect(shouldAutoCheck({ ...READY, lastAsked: READY.key, key: moved })).toBe(true);
  });

  it('asks again when the payment mode changes, because the RTO risk does', () => {
    const prepaid = addressCheckKey('560001', 'prepaid', '12 MG Road, Near City Hospital');
    expect(shouldAutoCheck({ ...READY, lastAsked: READY.key, key: prepaid })).toBe(true);
  });
});

describe('addressCheckKey', () => {
  it('separates the three parts so they cannot run together', () => {
    // Without a separator "56000" + "1..." and "560001" + "..." would
    // collide, and a changed PIN would read as already asked.
    expect(addressCheckKey('560001', 'cod', 'A')).not.toBe(addressCheckKey('56000', 'cod', '1A'));
  });
});

describe('the pause', () => {
  it('is long enough to be one question per edit, short enough to feel live', () => {
    expect(AUTO_CHECK_PAUSE_MS).toBeGreaterThanOrEqual(500);
    expect(AUTO_CHECK_PAUSE_MS).toBeLessThanOrEqual(1500);
  });
});

describe('suggestedAddressLine1', () => {
  // Recorded from a live probe on 2026-11-09, verbatim.
  const EXTRACTED = {
    house: '12',
    street: null,
    locality: 'Raydighi',
    village_city: 'Raydighi Abad',
    landmark: 'Hanuman Mandir',
    post_office: 'Raidighi',
    police_station: null,
    sub_district: 'Mathurapur II',
    district: 'South 24 Parganas',
    state: 'West Bengal',
    pincode: '743383',
  };
  // The case that proved the first version was dead code, recorded
  // from the client console on 2026-11-09. The operator typed
  // "Nadibhag, Badu Industrial Area" and NEITHER word survives their
  // extraction — so anything that replaced line 1 would have dropped
  // them, and the loss guard rightly refused it every single time.
  const REAL_EXTRACTED = {
    house: '48',
    street: '2 sarani',
    locality: 'Badu',
    village_city: 'Badu',
    landmark: null,
    post_office: 'Badu (North 24 Parganas)',
    police_station: 'Madhyamgram',
    sub_district: 'Barasat I',
    district: 'North 24 Parganas',
    state: 'West Bengal',
    pincode: '700128',
  };
  const TYPED = 'Nadibhag, Badu Industrial Area';

  it('ADDS the resolved parts and keeps every word the operator typed', () => {
    expect(suggestedAddressLine1(TYPED, REAL_EXTRACTED)).toBe(
      'Nadibhag, Badu Industrial Area, PO Badu (North 24 Parganas), PS Madhyamgram',
    );
  });

  it('never loses a word, which is what the old version could not promise', () => {
    const next = suggestedAddressLine1(TYPED, REAL_EXTRACTED);
    expect(suggestionKeepsEverything(next, TYPED)).toBe(true);
  });

  it('does not repeat a district already named inside the post office', () => {
    // "PO Badu (North 24 Parganas)" has it; appending it again would be
    // noise. With no parenthetical it IS appended — see below.
    const next = suggestedAddressLine1(TYPED, REAL_EXTRACTED);
    expect(next.match(/North 24 Parganas/g) ?? []).toHaveLength(1);
  });

  it('appends the district when the post office does not carry it', () => {
    expect(
      suggestedAddressLine1('Nadibhag', { post_office: 'Badu', district: 'North 24 Parganas' }),
    ).toBe('Nadibhag, PO Badu, North 24 Parganas');
  });

  it('LEAVES THE LANDMARK OUT — the bug this whole function exists for', () => {
    // Line 2 IS the landmark here (ORD-5), and their `completed_address`
    // always contains it whichever way it is sent, so taking their
    // sentence put it on the parcel twice.
    const next = suggestedAddressLine1(TYPED, { ...EXTRACTED, district: 'South 24 Parganas' });
    expect(next.toLowerCase()).not.toContain('hanuman');
  });

  it('leaves out the state and the PIN, which the PIN field owns', () => {
    const next = suggestedAddressLine1(TYPED, REAL_EXTRACTED);
    expect(next).not.toContain('West Bengal');
    expect(next).not.toContain('700128');
  });

  it('takes an INFERRED post office — adding is not rewording', () => {
    // Both of these came back `inferred` in the real case above, and
    // they are exactly the value the service adds. An inferred value
    // may ADD a part nobody typed; it may never REPLACE one.
    const next = suggestedAddressLine1(TYPED, REAL_EXTRACTED);
    expect(next).toContain('PO Badu (North 24 Parganas)');
    expect(next).toContain('PS Madhyamgram');
  });

  it('does not touch the house, street or locality the operator wrote', () => {
    const next = suggestedAddressLine1(TYPED, REAL_EXTRACTED);
    expect(next).not.toContain('48');
    expect(next).not.toContain('2 sarani');
  });

  it('says nothing when there is nothing to add', () => {
    expect(suggestedAddressLine1(TYPED, null)).toBe('');
    expect(suggestedAddressLine1(TYPED, undefined)).toBe('');
    expect(suggestedAddressLine1(TYPED, {})).toBe('');
    expect(suggestedAddressLine1(TYPED, { state: 'West Bengal', pincode: '700128' })).toBe('');
    // Already there, in the operator's own words.
    expect(suggestedAddressLine1('Nadibhag, PO Badu', { post_office: 'Badu' })).toBe('');
  });
});

describe('suggestionKeepsEverything', () => {
  it('refuses a suggestion that lost a word the operator typed', () => {
    // Their extraction is not lossless: a typed "H.No 12" comes back as
    // `house: "12"`. A tidier line with "H.No" silently gone is worse
    // than leaving the operator's own words alone.
    expect(suggestionKeepsEverything('12, Raydighi', 'H.No 12, Vill Raydighi')).toBe(false);
  });

  it('accepts one that adds without subtracting', () => {
    expect(suggestionKeepsEverything('12, Raydighi, South 24 Parganas', '12, Raydighi')).toBe(true);
  });

  it('is not tripped by punctuation or case', () => {
    expect(suggestionKeepsEverything('12, raydighi', 'H.No. 12 — Raydighi,')).toBe(false);
    expect(suggestionKeepsEverything('No 12, Raydighi', '12, raydighi')).toBe(true);
  });

  it('accepts anything when line 1 is still empty', () => {
    expect(suggestionKeepsEverything('12, Raydighi', '')).toBe(true);
  });
});

describe('suggestionIsWorthOffering', () => {
  it('offers a suggestion that says something new', () => {
    expect(suggestionIsWorthOffering('12 MG Road, PO Badu', '12 MG Road')).toBe(true);
  });

  it('does not offer back what is already there', () => {
    expect(suggestionIsWorthOffering('12 MG Road', '12 MG Road')).toBe(false);
  });

  it('ignores case, spacing and trailing commas', () => {
    // Applying one of these would change the text, which starts another
    // check, which returns the same suggestion — a loop with an Undo
    // button on it.
    expect(suggestionIsWorthOffering('12 MG Road', '12  mg road,')).toBe(false);
  });

  it('offers nothing when there is no suggestion', () => {
    expect(suggestionIsWorthOffering('', 'anything')).toBe(false);
  });
});

describe('the form wires all three senders through the dedupe', () => {
  it('has no bare addressCheck.mutate left outside sendAddressCheck', async () => {
    // Three paths ask: the automatic check, the Check again button, and
    // applying one of their suggestions. If any of them calls mutate
    // directly, it does not record what it asked — and the automatic
    // check, seeing the edited text on the next render, asks the same
    // question over again.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const raw = readFileSync(
      join(__dirname, '../app/(authed)/orders/new-v2/_components/new-order-form.tsx'),
      'utf8',
    );
    expect(raw.match(/addressCheck\.mutate\(/g) ?? []).toHaveLength(1);
    expect(raw).toContain('lastAsked.current = addressCheckKey(');
  });
});
