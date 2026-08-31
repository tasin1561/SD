import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TRE-3 resolves a settlement's receiving account through
 * `platform_bank_accounts.courier_account_id`, and refuses when there
 * isn't one — telling the operator to "link one under Network → Bank
 * accounts".
 *
 * The column, its relation and its index had existed since the treasury
 * shipped. The WRITE PATH had not: the DTO did not accept the field, so
 * neither the create nor the update handler could set it, and no screen
 * offered it. Recording a courier payout was therefore impossible
 * through the product, and the error message named a place that could
 * not do the job.
 *
 * Structural, because nothing behavioural sees it. Every unit test of
 * the settlement passes with the link written directly by a fixture,
 * and the API returns a perfectly valid account either way — the
 * failure only appears when a human tries to use the feature.
 */
const DTO = readFileSync(
  join(__dirname, '../../src/modules/wallet-topup/dto/wallet-topup.dto.ts'),
  'utf8',
);
const CONTROLLER = readFileSync(
  join(
    __dirname,
    '../../src/modules/wallet-topup/controllers/admin-platform-bank-account.controller.ts',
  ),
  'utf8',
);
const SETTLEMENT = readFileSync(
  join(__dirname, '../../src/modules/courier-settlement/services/courier-settlement.service.ts'),
  'utf8',
);

describe('a platform bank account can be linked to the courier it receives for', () => {
  it('the settlement still resolves through courierAccountId', () => {
    // If this ever stops being the lookup, the rest of this suite is
    // guarding the wrong column.
    expect(SETTLEMENT).toContain('courierAccountId: input.courierAccountId');
    expect(SETTLEMENT).toContain('SETTLEMENT_NO_RECEIVING_ACCOUNT');
  });

  it('the DTO accepts the link', () => {
    expect(DTO).toMatch(/courierAccountId\?: string;/);
  });

  it('both write paths persist it, so a link can be made AND removed', () => {
    const create = CONTROLLER.slice(CONTROLLER.indexOf('platformBankAccount.create'));
    expect(create.slice(0, 900)).toContain('courierAccountId');
    const update = CONTROLLER.slice(CONTROLLER.indexOf('platformBankAccount.update'));
    expect(update.slice(0, 900)).toContain('courierAccountId');
  });

  it('refuses a link to a courier account that does not exist', () => {
    // A link naming nothing is worse than no link: the lookup keeps
    // returning nothing and keeps saying "link one", with a link
    // already on the row.
    expect(CONTROLLER).toContain('COURIER_ACCOUNT_NOT_FOUND');
    expect(CONTROLLER).toContain('assertCourierAccount');
  });

  it('the admin form offers the field', () => {
    // The endpoint existed and the screen did not, which is how this
    // was invisible: `grep @Controller` finds the route, and only a
    // person clicking finds the missing input.
    const panel = readFileSync(
      join(
        __dirname,
        '../../../../apps/admin/src/app/(authed)/bank-accounts/_bank-accounts-panel.tsx',
      ),
      'utf8',
    );
    expect(panel).toContain('courierAccountId');
    expect(panel).toContain('Receives payouts from');
  });
});
