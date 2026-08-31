import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A courier pays us into ONE account; ONE account of ours receives from
 * every courier. The link therefore lives on the COURIER.
 *
 * It was on the bank account first (`platform_bank_accounts.courier_account_id`),
 * which had that backwards — one account could name one courier, while
 * a courier could be named by many accounts. Two consequences, both
 * silent:
 *
 *   1. An operator with a single current account could link it to
 *      Delhivery OR Shiprocket, never both, and the second courier's
 *      settlements were refused for a link there was no way to make.
 *   2. The receiving account was AMBIGUOUS. The settlement resolved it
 *      with an unordered `findFirst`, so two accounts naming one
 *      courier sent the cash to whichever row came back first.
 *
 * Structural, because nothing behavioural sees it: a fixture writes one
 * link, the settlement finds it, and every test passes under either
 * direction. Only a second courier reveals it.
 */
const SCHEMA = readFileSync(
  join(__dirname, '../../../../packages/db/prisma/schema.prisma'),
  'utf8',
);
const SETTLEMENT = readFileSync(
  join(__dirname, '../../src/modules/courier-settlement/services/courier-settlement.service.ts'),
  'utf8',
);
const COURIER_SVC = readFileSync(
  join(
    __dirname,
    '../../src/modules/courier-account-admin/services/courier-account-admin.service.ts',
  ),
  'utf8',
);

function model(name: string): string {
  const start = SCHEMA.indexOf(`model ${name} {`);
  return SCHEMA.slice(start, SCHEMA.indexOf('\n}', start));
}

describe('the courier payout link points from the courier at the bank account', () => {
  it('the courier owns a single nullable FK', () => {
    expect(model('CourierAccount')).toContain('payoutBankAccountId String?');
  });

  it('a bank account holds MANY couriers, which is the case that was impossible', () => {
    // The list IS the fix: one current account receiving from Delhivery
    // and Shiprocket at once.
    expect(model('PlatformBankAccount')).toMatch(/courierPayouts\s+CourierAccount\[\]/);
  });

  it('the old backwards column is gone, so there is one place to look', () => {
    expect(model('PlatformBankAccount')).not.toContain('courierAccountId');
  });

  it('the settlement reads the link off the courier, not by searching accounts', () => {
    // An unordered findFirst over bank accounts is what made the
    // receiving account arbitrary when two named one courier.
    expect(SETTLEMENT).toContain('courierAccount.findFirst');
    expect(SETTLEMENT).toContain('payoutBankAccount');
    expect(SETTLEMENT).not.toMatch(/platformBankAccount\.findFirst/);
    expect(SETTLEMENT).toContain('SETTLEMENT_NO_RECEIVING_ACCOUNT');
  });

  it('a link naming nothing, or a non-INR account, is refused at the form', () => {
    // Left to the foreign key this is a 500; and a taka account would
    // pass the link only to be refused by TRE-2 at settlement time,
    // long after anyone was looking at the form.
    expect(COURIER_SVC).toContain('PAYOUT_BANK_ACCOUNT_NOT_FOUND');
    expect(COURIER_SVC).toContain('PAYOUT_BANK_ACCOUNT_WRONG_CURRENCY');
  });

  it('the courier account screen offers the picker', () => {
    // The endpoint existing is not evidence a human can reach it —
    // the previous version of this link had a column, a relation and an
    // index, and no field on any form.
    const modal = readFileSync(
      join(
        __dirname,
        '../../../../apps/admin/src/app/(authed)/courier-accounts/_components/edit-courier-account-modal.tsx',
      ),
      'utf8',
    );
    expect(modal).toContain('payoutBankAccountId');
    expect(modal).toContain('COD payouts land in');
  });
});
