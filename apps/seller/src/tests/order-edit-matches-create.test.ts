import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Editing an order offers what creating one does.
 *
 * The edit form was a SUBSET of the create form and nobody could see
 * it: the lines were read-only, the economics went read-only the moment
 * the order left DRAFT, and five fields the create form asks for — the
 * advance, the delivery fee, the discount, the reference and the
 * shopfront — were absent from the edit DTO entirely. Each gap looked
 * deliberate on its own, and together they meant "edit" quietly meant
 * something narrower than "create".
 *
 * Structural on purpose. The failure is a field MISSING from a screen,
 * and a behavioural test only ever asserts what somebody remembered to
 * write down; reading both files and comparing them is what notices the
 * one that was forgotten.
 */
const CREATE = 'src/app/(authed)/orders/new/_components/new-order-form.tsx';
const EDIT = 'src/app/(authed)/orders/[id]/edit/_components/edit-order-form.tsx';

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

/** Fields the create form gathers that the edit form must gather too. */
const SHARED_FIELDS = [
  'recipientName',
  'recipientPhoneE164',
  'recipientAddressLine1',
  'recipientAddressLine2',
  'recipientPostalCode',
  'paymentMode',
  'codAmountInr',
  'advanceAmountInr',
  'deliveryFeeInr',
  'discountInr',
  'declaredValueInr',
  'totalWeightGrams',
  'sellerOrderRef',
  'storeId',
  'sellerNotes',
] as const;

describe('the edit form is not a subset of the create form', () => {
  const create = read(CREATE);
  const edit = read(EDIT);

  for (const field of SHARED_FIELDS) {
    it(`edit gathers ${field}`, () => {
      // In the create form by construction — if it ever is not, the pair
      // has drifted the other way and that is worth failing on too.
      expect(create).toContain(field);
      expect(edit).toContain(field);
    });
  }

  it('edit lets the seller add and remove products', () => {
    // The picker is the add path; onRemove is the remove path. Both come
    // from the shared component, so importing it is the check.
    expect(edit).toContain('ProductCatalogue');
    expect(edit).toContain('OrderedProducts');
    expect(edit).toMatch(/onRemove=/);
  });

  it('both screens compute the collectable the same way', () => {
    // Items + delivery − advance − discount. Two screens deriving it
    // differently is how a seller is shown one number and the customer
    // asked for another.
    for (const src of [create, edit]) {
      expect(src).toMatch(
        /itemsTotal\s*\+[\s\S]{0,200}deliveryFeeInr[\s\S]{0,200}advanceAmountInr[\s\S]{0,200}discountInr/,
      );
    }
  });

  it('the edit form no longer claims the economics are locked', () => {
    // The old copy told the seller "recipient + notes only". Leaving
    // that on screen while the fields work is worse than either state.
    expect(edit).not.toContain('economicsLocked');
    expect(edit).not.toContain('discard &amp; recreate');
  });
});
