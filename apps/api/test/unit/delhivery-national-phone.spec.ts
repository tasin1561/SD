import { toNationalPhone } from '../../src/modules/courier-delhivery/services/delhivery-awb.service';

/**
 * Delhivery's create API takes the NATIONAL number.
 *
 * Every sample in their own documentation sends "9999999999". We were
 * sending E.164 — "+919876543210" — and the first real create came back
 * with their generic "An internal Error has occurred, Please get in
 * touch with client.support@delhivery.com": no named field, which is
 * how a parser choking on an unexpected prefix presents.
 *
 * The stripping happens AT THE WIRE, not in storage: the stored E.164 is
 * still the number an agent dials and the one a webhook matches on.
 */
describe('toNationalPhone', () => {
  it('strips +91 from an Indian mobile', () => {
    expect(toNationalPhone('+919876543210')).toBe('9876543210');
  });

  it('leaves a NON-Indian number alone', () => {
    // Being refused is recoverable; a mangled number on a manifested
    // parcel is not. Passing it through makes the refusal visible.
    expect(toNationalPhone('+8801819912939')).toBe('+8801819912939');
  });

  it('leaves an unexpected shape alone rather than guessing', () => {
    // +91 with the wrong digit count is not a number we understand, and
    // "understand it anyway" is how a wrong parcel gets created.
    expect(toNationalPhone('+91987654321')).toBe('+91987654321');
    expect(toNationalPhone('+9198765432101')).toBe('+9198765432101');
  });

  it('passes through an already-national number', () => {
    expect(toNationalPhone('9876543210')).toBe('9876543210');
  });

  it('trims surrounding whitespace', () => {
    expect(toNationalPhone('  +919876543210 ')).toBe('9876543210');
  });
});
