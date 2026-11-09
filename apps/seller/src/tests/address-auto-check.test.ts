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
  const SOURCE = {
    house: 'customer',
    landmark: 'customer',
    post_office: 'inferred',
    locality: 'customer',
    village_city: 'inferred',
    sub_district: 'pincode',
    district: 'pincode',
    state: 'pincode',
    pincode: 'customer',
    police_station: 'unknown',
  };

  it('LEAVES THE LANDMARK OUT — the whole point of composing by field', () => {
    // Line 2 IS the landmark here (ORD-5). Their `completed_address`
    // always contains it, whichever way it is sent, so taking their
    // sentence put it on the parcel twice.
    const line1 = suggestedAddressLine1(EXTRACTED, SOURCE);
    expect(line1.toLowerCase()).not.toContain('hanuman');
  });

  it('leaves out the state and the PIN, which the PIN field owns', () => {
    const line1 = suggestedAddressLine1(EXTRACTED, SOURCE);
    expect(line1).not.toContain('West Bengal');
    expect(line1).not.toContain('743383');
  });

  it('drops a field they INFERRED rather than reword the customer', () => {
    // `village_city: "Raydighi Abad"` is inferred from a typed
    // "Raydighi". Writing it back would be us editing the customer's
    // address and showing it to the operator as theirs.
    const line1 = suggestedAddressLine1(EXTRACTED, SOURCE);
    expect(line1).not.toContain('Raydighi Abad');
    expect(line1).not.toContain('Raidighi'); // post_office, also inferred
    expect(line1).toContain('Raydighi'); // locality, from the customer
  });

  it('keeps the fields the customer gave and the PIN decided, in order', () => {
    expect(suggestedAddressLine1(EXTRACTED, SOURCE)).toBe('12, Raydighi, South 24 Parganas');
  });

  it('labels the post office and police station when they are the customer’s', () => {
    const line1 = suggestedAddressLine1(
      { post_office: 'Badu', police_station: 'Madhyamgram' },
      { post_office: 'customer', police_station: 'customer' },
    );
    expect(line1).toBe('PO Badu, PS Madhyamgram');
  });

  it('takes everything when no field_source came back at all', () => {
    // A missing map is not evidence of a guess — an older response or a
    // stub. Refusing every field there would mean never suggesting.
    const line1 = suggestedAddressLine1({ locality: 'Raydighi', district: 'South 24 Parganas' });
    expect(line1).toBe('Raydighi, South 24 Parganas');
  });

  it('reads nothing as nothing', () => {
    expect(suggestedAddressLine1(null)).toBe('');
    expect(suggestedAddressLine1(undefined)).toBe('');
    expect(suggestedAddressLine1({})).toBe('');
    expect(suggestedAddressLine1({ landmark: 'Hanuman Mandir', state: 'West Bengal' })).toBe('');
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
