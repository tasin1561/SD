import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { rowFailureForSeller } from '../../src/modules/order-csv-import/services/order-csv-import-processor.service';
import {
  ORDER_CSV_TARGET_FIELDS,
  orderCsvFieldLabel,
} from '../../src/modules/order-csv-import/order-csv-fields';

/**
 * What a seller is told when one row of their upload will not import.
 *
 * Every failure used to be `err.message`, verbatim, into
 * `staged_order_rows.problems[].reason` and into the error-report CSV
 * the seller downloads. Found by filming B3 (2026-09-30): a Prisma
 * interactive-transaction timeout on one row wrote this onto the
 * seller's Pending page —
 *
 *   Invalid `client.customer.findFirst()` invocation in
 *   /home/…/apps/api/dist/modules/order/services/customer.service.js:83:48
 *   …Transaction already closed…
 *
 * — our absolute file path, an excerpt of our source, and the advisory
 * lock it was inside. And because those rows carry `field: ''` the page
 * said "1 value to fix" and marked no field, so the seller was asked to
 * correct something no value they could type would ever fix.
 */
describe('rowFailureForSeller', () => {
  it('repeats OUR OWN refusal about their data, which is the point of the screen', () => {
    const out = rowFailureForSeller(
      new BadRequestException({ code: 'SKU_NOT_FOUND', message: 'No variant with SKU RSH-X' }),
    );
    expect(out.sellerSafe).toBe(true);
    expect(out.reason).toBe('No variant with SKU RSH-X');
  });

  it('never shows a seller an error that is not about their data', () => {
    const prisma = new Error(
      'Invalid `client.customer.findFirst()` invocation in\n' +
        '/home/talha/projects/SD/apps/api/dist/modules/order/services/customer.service.js:83:48\n' +
        'Transaction already closed: A query cannot be executed on an expired transaction.',
    );
    const out = rowFailureForSeller(prisma);
    expect(out.sellerSafe).toBe(false);
    expect(out.reason).not.toContain('customer.service');
    expect(out.reason).not.toContain('/home/');
    expect(out.reason).not.toContain('Transaction');
    // And it says whose problem it is, because "1 value to fix" with no
    // field marked is a loop the seller cannot get out of.
    expect(out.reason).toContain('Nothing is wrong with what you sent');
  });

  it('treats a 5xx of our own as ours too', () => {
    const out = rowFailureForSeller(new InternalServerErrorException('boom'));
    expect(out.sellerSafe).toBe(false);
    expect(out.reason).not.toContain('boom');
  });

  it('says something rather than nothing when the thrown value is not an Error', () => {
    const out = rowFailureForSeller('nope');
    expect(out.sellerSafe).toBe(false);
    expect(out.reason.length).toBeGreaterThan(20);
  });
});

/**
 * And what a field is CALLED when we tell a seller it is missing.
 *
 * The messages read `addressLine2 is required` and `customerPhone is
 * required` — our internal key, printed under a form field labelled
 * "Address line 2" and over a spreadsheet column headed "Address Line2".
 * Found on the same page as the failure above, filming B3.
 */
describe('orderCsvFieldLabel', () => {
  it('never hands a seller an internal key', () => {
    for (const f of ORDER_CSV_TARGET_FIELDS) {
      const label = orderCsvFieldLabel(f);
      expect(label).not.toMatch(/[a-z][A-Z]/); // no camelCase left
      expect(label[0]).toBe(label[0]?.toUpperCase());
    }
  });

  it('uses the name the seller’s own file most likely uses', () => {
    // The alias list is the source, so the label is the spelling their
    // own header most likely carries — Delhivery's, in these two.
    expect(orderCsvFieldLabel('addressLine2')).toBe('Address line2');
    expect(orderCsvFieldLabel('customerPhone')).toBe('Customer phone');
    expect(orderCsvFieldLabel('pinCode')).toBe('Pin code');
  });
});
