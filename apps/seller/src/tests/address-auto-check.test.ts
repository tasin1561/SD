import { describe, expect, it } from 'vitest';
import {
  AUTO_CHECK_PAUSE_MS,
  addressCheckKey,
  shouldAutoCheck,
  suggestedAddressLine1,
  suggestionIsWorthOffering,
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
  // A real answer, recorded from the client console on 2026-11-09.
  const REAL =
    'Nadibhag, Badu Industrial Area, 48, 2 Sarani, PO Badu (North 24 Parganas), ' +
    'PS Madhyamgram, North 24 Parganas, West Bengal 700128';

  it('drops the trailing state and PIN, and nothing else', () => {
    expect(suggestedAddressLine1(REAL)).toBe(
      'Nadibhag, Badu Industrial Area, 48, 2 Sarani, PO Badu (North 24 Parganas), ' +
        'PS Madhyamgram, North 24 Parganas',
    );
  });

  it('leaves an address that does not end in a PIN alone', () => {
    // The safe direction to be wrong in: keep their words rather than
    // guess which trailing part was a state.
    const noPin = 'Nadibhag, Badu Industrial Area, PO Badu, PS Madhyamgram';
    expect(suggestedAddressLine1(noPin)).toBe(noPin);
  });

  it('never eats the whole address when there is only one part', () => {
    expect(suggestedAddressLine1('700128')).toBe('700128');
  });

  it('trims the trailing comma an operator left behind', () => {
    expect(suggestedAddressLine1('12 MG Road, Near City Hospital,')).toBe(
      '12 MG Road, Near City Hospital',
    );
  });

  it('reads nothing as nothing', () => {
    expect(suggestedAddressLine1(null)).toBe('');
    expect(suggestedAddressLine1('')).toBe('');
    expect(suggestedAddressLine1('   ')).toBe('');
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
