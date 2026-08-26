import { ConflictException } from '@nestjs/common';
import { BankChangeService } from './bank-change.service';
import { BankAccountCipherService } from '../../seller-profile/services/bank-account-cipher.service';
import { makeTestEnv } from '../../../../test/helpers/env';

/**
 * Approving a bank change is the one place a request reaches the live
 * withdrawal columns. What it writes there is where the seller's money goes.
 *
 * The account number is a TRIPLE — ciphertext, mask, key version — and
 * the three only mean anything together. Requests written before
 * 2026-08-18 carry the ciphertext but lost the other two, so copying the
 * request's own columns across would leave a live account that decrypts
 * to nothing and renders as a dash. The seller finds out when a withdrawal
 * fails, days later, and the number they had is gone.
 *
 * What is pinned:
 *  - a request that leaves the number alone writes the LIVE triple,
 *    whatever shape its own copy is in
 *  - a request that genuinely moves the number writes its own triple
 *  - a request whose number is incoherent is REFUSED, not guessed at
 */

const cipher = new BankAccountCipherService(makeTestEnv());

const LIVE = {
  bankAccountNumber: 'CIPHER-A',
  bankAccountNumberMasked: '••••4001',
  bankAccountNumberKeyVersion: 1,
};

interface Written {
  bankAccountNumber: string | null;
  bankAccountNumberMasked: string | null;
  bankAccountNumberKeyVersion: number | null;
  bankName: string;
}

async function approve(reqAccount: {
  bankAccountNumber: string;
  bankAccountNumberMasked: string;
  bankAccountNumberKeyVersion: number | null;
}): Promise<Written> {
  const sellerUpdate = jest.fn().mockResolvedValue({});
  const tx = {
    sellerBankChangeRequest: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'req-1',
        sellerId: 'seller-1',
        status: 'PENDING',
        bankName: 'The City Bank',
        bankBranchName: 'Pragati Sarani',
        bankAccountName: 'Menev Store',
        bankRoutingNumber: '123456789',
        bankSwiftCode: 'CBLDH',
        ...reqAccount,
        seller: { ...LIVE },
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    seller: {
      update: sellerUpdate,
      // The email lookup inside the decision tx.
      findUnique: jest.fn().mockResolvedValue({ email: 's@x.com', companyName: 'Menev Store' }),
    },
  };
  const prisma = { client: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } };
  const svc = new BankChangeService(
    prisma as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    cipher,
    { enqueue: jest.fn().mockResolvedValue('job-1') } as never,
    makeTestEnv(),
  );

  await svc.approve('req-1', 'staff-1');
  return (sellerUpdate.mock.calls[0]?.[0] as { data: Written }).data;
}

describe('BankChangeService.approve — the account number moves as a triple or not at all', () => {
  it('writes the LIVE triple when a pre-2026-08-18 request carries the number forward', async () => {
    // The exact production shape: right ciphertext, no mask, no key version.
    const written = await approve({
      bankAccountNumber: 'CIPHER-A',
      bankAccountNumberMasked: '',
      bankAccountNumberKeyVersion: null,
    });

    expect(written.bankAccountNumber).toBe(LIVE.bankAccountNumber);
    expect(written.bankAccountNumberMasked).toBe(LIVE.bankAccountNumberMasked);
    expect(written.bankAccountNumberKeyVersion).toBe(LIVE.bankAccountNumberKeyVersion);
    // The change the request WAS about still lands.
    expect(written.bankName).toBe('The City Bank');
  });

  it('writes the request its own triple when the number genuinely moved', async () => {
    const written = await approve({
      bankAccountNumber: 'CIPHER-B',
      bankAccountNumberMasked: '••••9999',
      bankAccountNumberKeyVersion: 1,
    });

    expect(written.bankAccountNumber).toBe('CIPHER-B');
    expect(written.bankAccountNumberMasked).toBe('••••9999');
  });

  it('REFUSES a request whose new number has no mask, rather than writing an unreadable account', async () => {
    // A new ciphertext with no mask cannot have come from the write path.
    // Approving costs the seller their withdrawals; rejecting costs them one
    // resubmission.
    await expect(
      approve({
        bankAccountNumber: 'CIPHER-B',
        bankAccountNumberMasked: '',
        bankAccountNumberKeyVersion: null,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
