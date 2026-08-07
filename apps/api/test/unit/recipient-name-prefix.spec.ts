import { composeSellerPrefixedName, stripSellerPrefix } from '../../src/common/text/recipient-name';

/**
 * The seller code on the recipient name.
 *
 * Two properties carry real weight. IDEMPOTENCE, because the seller's
 * edit form round-trips the stored value and a CSV re-upload resubmits
 * it — prefixing blindly gives "MSt MSt John Doe" and nobody sees it
 * until it is printed on a waybill. And the STRIP being exact, because
 * it runs on the way to a customer's inbox and a tax invoice: too eager
 * and it eats part of a real name.
 */

describe('composeSellerPrefixedName', () => {
  it('puts the code in front', () => {
    expect(composeSellerPrefixedName('MSt', 'John Doe')).toBe('MSt John Doe');
  });

  it('is idempotent — applying it twice changes nothing', () => {
    const once = composeSellerPrefixedName('MSt', 'John Doe');
    expect(composeSellerPrefixedName('MSt', once)).toBe('MSt John Doe');
    expect(composeSellerPrefixedName('MSt', composeSellerPrefixedName('MSt', once))).toBe(
      'MSt John Doe',
    );
  });

  it('normalises a re-typed code to the stored casing', () => {
    // An operator typing "mst john doe" must not produce "MSt mst john doe".
    expect(composeSellerPrefixedName('MSt', 'mst john doe')).toBe('MSt john doe');
  });

  it('trims, so a stray space cannot defeat the idempotency check', () => {
    expect(composeSellerPrefixedName('MSt', '  John Doe  ')).toBe('MSt John Doe');
  });

  it('leaves the name alone when the seller has no code yet', () => {
    // A seller predating the column must still be able to place an order.
    expect(composeSellerPrefixedName(null, 'John Doe')).toBe('John Doe');
    expect(composeSellerPrefixedName('', 'John Doe')).toBe('John Doe');
    expect(composeSellerPrefixedName('   ', 'John Doe')).toBe('John Doe');
  });

  it('does not treat a DIFFERENT code as already-applied', () => {
    expect(composeSellerPrefixedName('MSt', 'QTT John Doe')).toBe('MSt QTT John Doe');
  });
});

describe('stripSellerPrefix', () => {
  it('takes the code back off', () => {
    expect(stripSellerPrefix('MSt', 'MSt John Doe')).toBe('John Doe');
  });

  it('round-trips with compose', () => {
    expect(stripSellerPrefix('MSt', composeSellerPrefixedName('MSt', 'John Doe'))).toBe('John Doe');
  });

  it('leaves an unprefixed name untouched', () => {
    expect(stripSellerPrefix('MSt', 'John Doe')).toBe('John Doe');
  });

  it('requires the separator, so it cannot eat a real name', () => {
    // Someone actually called "MStanley" keeps their name.
    expect(stripSellerPrefix('MSt', 'MStanley Roy')).toBe('MStanley Roy');
  });

  it('only removes the FIRST occurrence', () => {
    // A customer whose name genuinely contains the code keeps it.
    expect(stripSellerPrefix('MSt', 'MSt MSt Roy')).toBe('MSt Roy');
  });

  it('does not strip another seller’s code', () => {
    expect(stripSellerPrefix('MSt', 'QTT John Doe')).toBe('QTT John Doe');
  });

  it('is a no-op when the seller has no code', () => {
    expect(stripSellerPrefix(null, 'MSt John Doe')).toBe('MSt John Doe');
  });
});

describe('the customer-facing boundary', () => {
  it('what the courier sees and what the customer sees differ by exactly the code', () => {
    const stored = composeSellerPrefixedName('MSt', 'John Doe');
    expect(stored).toBe('MSt John Doe'); // waybill / packing bench
    expect(stripSellerPrefix('MSt', stored)).toBe('John Doe'); // email / invoice
  });
});
