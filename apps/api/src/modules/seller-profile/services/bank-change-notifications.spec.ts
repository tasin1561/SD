import { SellerProfileService } from './seller-profile.service';
import { BankAccountCipherService } from './bank-account-cipher.service';
import { makeTestEnv } from '../../../../test/helpers/env';

/**
 * Where a seller's money goes is the highest-stakes thing about their
 * account, so every move is announced — including the ones they made
 * themselves. The message is not a receipt; it is the alarm for the
 * person who did NOT do it. Someone who got into a seller's account
 * would otherwise redirect the withdrawals in silence.
 *
 * Also pinned here: the banner shows the LATEST request and only while
 * it is unresolved. Filtering to PENDING/REJECTED in the query looks
 * equivalent and is not — after an approval it resurfaces some older
 * rejection, telling the seller their change was refused while they are
 * looking at the details it applied.
 */

const CTX = { ipAddress: '127.0.0.1', userAgent: 'jest', requestId: 'req-1' };
const cipher = new BankAccountCipherService(makeTestEnv());
const ON_FILE = cipher.encrypt('1234567890');

const FULL = {
  id: 'seller-1',
  bankName: 'Dutch-Bangla Bank Ltd.',
  bankBranchName: 'Gulshan Circle-1 Branch',
  bankAccountName: 'Menev Store',
  bankAccountNumber: ON_FILE.storedValue,
  bankAccountNumberMasked: ON_FILE.masked,
  bankAccountNumberKeyVersion: ON_FILE.keyVersion,
  bankRoutingNumber: '090260534',
  bankSwiftCode: 'CBLDH',
};
const EMPTY = {
  ...FULL,
  bankName: null,
  bankBranchName: null,
  bankAccountName: null,
  bankAccountNumber: null,
  bankAccountNumberMasked: null,
  bankAccountNumberKeyVersion: null,
  bankRoutingNumber: null,
  bankSwiftCode: null,
};

interface Sent {
  templateCode: string;
  variables: Record<string, string>;
}

function makeService(
  stored: Record<string, unknown>,
  latestChange: Record<string, unknown> | null = null,
): { svc: SellerProfileService; sent: jest.Mock } {
  const sent = jest.fn().mockResolvedValue('job-1');
  const tx = {
    seller: {
      findFirst: jest.fn().mockResolvedValue(stored),
      findUnique: jest.fn().mockResolvedValue({ email: 's@x.com', companyName: 'Menev Store' }),
      // Returns the row AS UPDATED — the service reads the new mask off
      // this to name the account in the email, so a mock that echoes the
      // old row would hide whether it reads the right one.
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
        ...stored,
        ...data,
      })),
    },
    sellerBankChangeRequest: { create: jest.fn().mockResolvedValue({ id: 'req-1' }) },
  };
  const prisma = {
    client: {
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
      seller: { findFirst: jest.fn().mockResolvedValue(stored) },
      sellerBankChangeRequest: { findFirst: jest.fn().mockResolvedValue(latestChange) },
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
    { enqueue: sent } as never,
    makeTestEnv(),
  );
  return { svc, sent };
}

const codes = (sent: jest.Mock): string[] =>
  sent.mock.calls.map((c) => (c[0] as Sent).templateCode);

describe('bank details — the seller is told every time the destination could move', () => {
  it('emails on a FIRST add, with the last four digits and never the number', async () => {
    const { svc, sent } = makeService(EMPTY);
    await svc.updateBankDetails(
      'seller-1',
      {
        bankName: 'Dutch-Bangla Bank Ltd.',
        bankBranchName: 'Gulshan Circle-1 Branch',
        bankAccountName: 'Menev Store',
        bankAccountNumber: '1234567890',
        bankRoutingNumber: '090260534',
        bankSwiftCode: 'CBLDH',
      },
      CTX,
    );

    expect(codes(sent)).toEqual(['seller.bank_details_added.email']);
    const vars = (sent.mock.calls[0]?.[0] as Sent).variables;
    expect(vars['account_last4']).toBe('7890');
    // The number itself must never reach a mailbox.
    expect(JSON.stringify(vars)).not.toContain('1234567890');
  });

  it('emails when a CHANGE is submitted for approval', async () => {
    const { svc, sent } = makeService(FULL);
    await svc.updateBankDetails('seller-1', { bankBranchName: 'Banani Branch' }, CTX);

    expect(codes(sent)).toEqual(['seller.bank_change_submitted.email']);
  });

  it('emails when the account is REMOVED — we now have nowhere to pay', async () => {
    const { svc, sent } = makeService(FULL);
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

    expect(codes(sent)).toEqual(['seller.bank_details_removed.email']);
  });
});

describe('bank details — the banner shows the latest request, and only while unresolved', () => {
  const change = (status: string): Record<string, unknown> => ({
    id: 'req-1',
    status,
    submittedAt: new Date(),
    decidedAt: new Date(),
    decisionReason: 'Testing the rejection',
    bankName: 'The City Bank',
    bankBranchName: 'Pragati Sarani',
    bankAccountName: 'Menev Store',
    bankAccountNumber: ON_FILE.storedValue,
    bankAccountNumberMasked: ON_FILE.masked,
    bankAccountNumberKeyVersion: ON_FILE.keyVersion,
    bankRoutingNumber: '090260534',
    bankSwiftCode: 'CBLDH',
  });

  it('shows a REJECTED request', async () => {
    const { svc } = makeService(FULL, change('REJECTED'));
    const out = await svc.getProfile('seller-1');
    expect(out.latestBankChange?.status).toBe('REJECTED');
    expect(out.latestBankChange?.decisionReason).toBe('Testing the rejection');
  });

  it('shows NOTHING once the latest request was APPROVED', async () => {
    // The bug: the query asked for the latest PENDING-or-REJECTED, so a
    // successful edit left an older rejection on screen saying the change
    // had been refused.
    const { svc } = makeService(FULL, change('APPROVED'));
    const out = await svc.getProfile('seller-1');
    expect(out.latestBankChange).toBeNull();
  });
});
