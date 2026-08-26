import { SellerProfileService } from './seller-profile.service';
import { BankAccountCipherService } from './bank-account-cipher.service';
import { makeTestEnv } from '../../../../test/helpers/env';

/**
 * A bank CHANGE REQUEST must be a complete account, not a diff.
 *
 * An edit sends only the fields the seller touched. The admin reviewing
 * the request is deciding where this seller's money goes next, so the
 * row they approve has to describe the whole destination — including the
 * fields the seller never retyped. Before this was fixed, editing (say)
 * the branch name stored an EMPTY account number on the request and the
 * review queue rendered a dash in the one column that decides the withdrawal.
 *
 * What is pinned:
 *  - an untouched account number carries forward as ciphertext, mask AND
 *    key version, all three together
 *  - a retyped number replaces all three with the NEW ones — never the
 *    new ciphertext paired with the old key version, which decrypts to
 *    nothing
 *  - untouched ordinary fields carry forward too
 */

const CTX = { ipAddress: '127.0.0.1', userAgent: 'jest', requestId: 'req-1' };

const cipher = new BankAccountCipherService(makeTestEnv());
const ON_FILE = cipher.encrypt('1234567890');

/** A seller with a complete, payable account already on file. */
const STORED = {
  id: 'seller-1',
  bankName: 'Dutch-Bangla Bank Ltd.',
  bankBranchName: 'Gulshan Circle-1 Branch',
  bankAccountName: 'Menev Store',
  bankAccountNumber: ON_FILE.storedValue,
  bankAccountNumberMasked: ON_FILE.masked,
  bankAccountNumberKeyVersion: ON_FILE.keyVersion,
  bankRoutingNumber: '090260534',
  bankSwiftCode: 'DBBLBDDH',
};

interface CreatedRequest {
  bankName: string;
  bankBranchName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankAccountNumberMasked: string;
  bankAccountNumberKeyVersion?: number;
  bankRoutingNumber: string;
  bankSwiftCode: string;
}

async function submit(
  patch: Record<string, string | null>,
  stored: typeof STORED = STORED,
): Promise<CreatedRequest> {
  const create = jest.fn().mockResolvedValue({ id: 'req-1' });
  const update = jest.fn().mockResolvedValue({});
  const tx = {
    seller: {
      findFirst: jest.fn().mockResolvedValue(stored),
      update,
      // The notify helper's lookup, inside the same tx.
      findUnique: jest.fn().mockResolvedValue({ email: 's@x.com', companyName: 'Menev Store' }),
    },
    sellerBankChangeRequest: { create },
  };
  const prisma = {
    client: {
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
      seller: { findFirst: jest.fn().mockResolvedValue(stored) },
      sellerBankChangeRequest: { findFirst: jest.fn().mockResolvedValue(null) },
    },
  };
  const svc = new SellerProfileService(
    prisma as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    {
      getProgress: jest.fn().mockResolvedValue({}),
      markStepComplete: jest.fn().mockResolvedValue(undefined),
    } as never,
    cipher,
    { presignGetUrl: jest.fn() } as never,
    { enqueue: jest.fn().mockResolvedValue('job-1') } as never,
    makeTestEnv(),
  );

  await svc.updateBankDetails('seller-1', patch, CTX);

  // An edit of an account already on file must ASK, never write.
  expect(update).not.toHaveBeenCalled();
  expect(create).toHaveBeenCalledTimes(1);
  return (create.mock.calls[0]?.[0] as { data: CreatedRequest }).data;
}

describe('SellerProfileService — a bank change request carries the whole account', () => {
  it('carries an untouched account number forward — ciphertext, mask and key version', async () => {
    const req = await submit({ bankBranchName: 'Banani Branch' });

    // The bug: these were '' , and the admin was asked to approve a blank.
    expect(req.bankAccountNumber).toBe(ON_FILE.storedValue);
    expect(req.bankAccountNumberMasked).toBe(ON_FILE.masked);
    expect(req.bankAccountNumberKeyVersion).toBe(ON_FILE.keyVersion);

    // And it must still decrypt — a ciphertext stored without its own key
    // version is unreadable, which is the same blank arriving later.
    expect(cipher.reveal(req.bankAccountNumber, req.bankAccountNumberKeyVersion ?? null)).toBe(
      '1234567890',
    );

    // The edit itself is present.
    expect(req.bankBranchName).toBe('Banani Branch');
  });

  it('carries every other untouched field forward too', async () => {
    const req = await submit({ bankBranchName: 'Banani Branch' });

    expect(req.bankName).toBe(STORED.bankName);
    expect(req.bankAccountName).toBe(STORED.bankAccountName);
    expect(req.bankRoutingNumber).toBe(STORED.bankRoutingNumber);
    expect(req.bankSwiftCode).toBe(STORED.bankSwiftCode);
  });

  it('replaces all three when the number IS retyped', async () => {
    const req = await submit({ bankAccountNumber: '9876543210' });

    expect(req.bankAccountNumber).not.toBe(ON_FILE.storedValue);
    expect(req.bankAccountNumberMasked).toBe(cipher.encrypt('9876543210').masked);
    // The NEW ciphertext with the OLD version would decrypt to nothing.
    expect(cipher.reveal(req.bankAccountNumber, req.bankAccountNumberKeyVersion ?? null)).toBe(
      '9876543210',
    );
  });

  it('stamps the NEW key version when a legacy plaintext row is retyped', async () => {
    // The only case where the two versions actually differ today: rows
    // predating encryption carry keyVersion=null and hold plaintext.
    // Carrying THAT version onto freshly encrypted ciphertext would
    // store a blob nothing decrypts — a blank arriving later instead of
    // now. (A same-version rotation cannot be tested until rotation
    // exists; CURRENT_KEY_VERSION is a constant.)
    const legacy = {
      ...STORED,
      bankAccountNumber: '1234567890',
      bankAccountNumberMasked: '••••7890',
      bankAccountNumberKeyVersion: null as number | null,
    };
    const req = await submit({ bankAccountNumber: '9876543210' }, legacy as typeof STORED);

    expect(req.bankAccountNumberKeyVersion).toBe(cipher.encrypt('9876543210').keyVersion);
    expect(cipher.reveal(req.bankAccountNumber, req.bankAccountNumberKeyVersion ?? null)).toBe(
      '9876543210',
    );
  });
});
