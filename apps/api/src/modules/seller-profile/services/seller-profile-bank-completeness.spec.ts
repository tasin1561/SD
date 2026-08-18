import { BadRequestException } from '@nestjs/common';
import { SellerProfileService } from './seller-profile.service';
import { BankAccountCipherService } from './bank-account-cipher.service';
import { makeTestEnv } from '../../../../test/helpers/env';

/**
 * Bank details are ALL-OR-NOTHING.
 *
 * The rule cannot live on the DTO: a PATCH carries only the fields the
 * seller edited, so whether the row ends up payable depends on the
 * columns the request never mentions. These tests drive the MERGE — a
 * patch landing on a stored row — which is the only place the question
 * is answerable.
 *
 * What is pinned:
 *  - a patch that leaves the row partially filled is refused, and the
 *    refusal NAMES the fields still needed (a seller cannot act on
 *    "invalid")
 *  - a seller whose row is already partial can still complete it — the
 *    rule bites on the shape you are SAVING, not on the shape you had
 *  - clearing all six is allowed; that is how an account is removed
 *  - nothing is written when the check refuses
 */

interface StoredSeller {
  id: string;
  bankName: string | null;
  bankBranchName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankRoutingNumber: string | null;
  bankSwiftCode: string | null;
}

const EMPTY: StoredSeller = {
  id: 'seller-1',
  bankName: null,
  bankBranchName: null,
  bankAccountName: null,
  bankAccountNumber: null,
  bankRoutingNumber: null,
  bankSwiftCode: null,
};

const FULL: StoredSeller = {
  id: 'seller-1',
  bankName: 'Dutch-Bangla Bank Ltd.',
  bankBranchName: 'Gulshan Circle-1 Branch',
  bankAccountName: 'Menev Store',
  bankAccountNumber: 'ciphertext',
  bankRoutingNumber: '090260534',
  bankSwiftCode: 'DBBLBDDH',
};

function makeService(stored: StoredSeller): {
  svc: SellerProfileService;
  update: jest.Mock;
} {
  const update = jest.fn().mockResolvedValue({
    bankName: null,
    bankAccountName: null,
    bankAccountNumber: null,
  });
  const tx = {
    seller: { findFirst: jest.fn().mockResolvedValue(stored), update },
  };
  const prisma = {
    client: {
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
      // updateBankDetails re-reads through getProfile on the way out.
      // That projection is not what these tests exercise; it only has to
      // resolve so the accept path can return.
      seller: {
        findFirst: jest.fn().mockResolvedValue({ ...stored, bankAccountNumberMasked: null }),
      },
    },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const onboarding = {
    getProgress: jest.fn().mockResolvedValue({}),
    markStepComplete: jest.fn().mockResolvedValue(undefined),
  };
  const spaces = { presignGetUrl: jest.fn() };

  const svc = new SellerProfileService(
    prisma as never,
    audit as never,
    onboarding as never,
    new BankAccountCipherService(makeTestEnv()),
    spaces as never,
  );
  return { svc, update };
}

const CTX = { ipAddress: '127.0.0.1', userAgent: 'jest', requestId: 'req-1' };

async function refusal(
  stored: StoredSeller,
  patch: Record<string, string | null>,
): Promise<{ code: string; message: string; wrote: boolean }> {
  const { svc, update } = makeService(stored);
  try {
    await svc.updateBankDetails('seller-1', patch, CTX);
    throw new Error('expected the save to be refused');
  } catch (e) {
    if (!(e instanceof BadRequestException)) throw e;
    const body = e.getResponse() as { code: string; message: string };
    return { ...body, wrote: update.mock.calls.length > 0 };
  }
}

describe('SellerProfileService — bank details are all-or-nothing', () => {
  it('refuses a partial account and names every field still needed', async () => {
    const out = await refusal(EMPTY, {
      bankName: 'Dutch-Bangla Bank Ltd.',
      bankAccountNumber: '1234567890',
    });

    expect(out.code).toBe('BANK_DETAILS_INCOMPLETE');
    expect(out.message).toContain('branch name');
    expect(out.message).toContain('account holder name');
    expect(out.message).toContain('routing number');
    expect(out.message).toContain('SWIFT code');
    // The two that WERE supplied must not be asked for again — a list
    // naming fields the seller just filled reads as the form ignoring them.
    expect(out.message).not.toContain('bank name');
    // Nothing partial reaches the row.
    expect(out.wrote).toBe(false);
  });

  it('refuses clearing ONE field out of a complete account', async () => {
    const out = await refusal(FULL, { bankSwiftCode: null });
    expect(out.code).toBe('BANK_DETAILS_INCOMPLETE');
    expect(out.message).toContain('SWIFT code');
  });

  it('treats a whitespace-only value as empty, not as filled', async () => {
    // Otherwise " " would satisfy the check while being useless to a bank.
    const out = await refusal(FULL, { bankBranchName: '   ' });
    expect(out.message).toContain('branch name');
  });

  it('accepts a patch that COMPLETES an already-partial row', async () => {
    // Existing sellers predate the rule; they must be able to edit their
    // way out of a partial account rather than be stuck with it.
    const partial: StoredSeller = { ...FULL, bankBranchName: null, bankSwiftCode: null };
    const { svc, update } = makeService(partial);
    await svc.updateBankDetails(
      'seller-1',
      { bankBranchName: 'Gulshan Circle-1 Branch', bankSwiftCode: 'DBBLBDDH' },
      CTX,
    );
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('accepts clearing all six together — that is how an account is removed', async () => {
    const { svc, update } = makeService(FULL);
    await svc.updateBankDetails(
      'seller-1',
      {
        bankName: null,
        bankBranchName: null,
        bankAccountName: null,
        bankAccountNumber: null,
        bankRoutingNumber: null,
        bankSwiftCode: null,
      },
      CTX,
    );
    expect(update).toHaveBeenCalledTimes(1);
  });
});
