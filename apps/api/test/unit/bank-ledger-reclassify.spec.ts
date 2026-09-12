import { Prisma } from '@skydrop/db';
import { AdvisoryLock, accountReconcileKey, advisoryKey } from '../../src/common/db/advisory-lock';
import { BankLedgerService } from '../../src/modules/treasury/services/bank-ledger.service';

/**
 * Correcting whose the cash in one account is. A zero-sum pair — the
 * statement's total cannot move — and never more than the giving side
 * actually holds there.
 */

type Post = {
  signedAmount: Prisma.Decimal;
  owner: { kind: string };
  type: string;
  inrBookValue?: Prisma.Decimal | null;
};

function makeSut(held: string, currency: 'INR' | 'BDT' = 'INR') {
  const posts: Post[] = [];
  const tx = {
    // (strings, namespace, key) — a tagged-template call.
    $executeRaw: jest.fn(async (..._args: unknown[]) => 1),
    platformBankAccount: {
      findFirst: jest.fn(async () => ({ currency, label: 'HDFC — COD receiving' })),
    },
    seller: { findUnique: jest.fn(async () => ({ id: 's1' })) },
  };
  const audit = { log: jest.fn(async () => 'a1') };
  const svc = Object.create(BankLedgerService.prototype) as BankLedgerService;
  Object.assign(svc, {
    prisma: { client: { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } },
    audit,
  });
  const ownerBalance = jest.spyOn(svc, 'ownerBalance').mockResolvedValue(new Prisma.Decimal(held));
  jest.spyOn(svc, 'post').mockImplementation(async (input) => {
    posts.push(input as unknown as Post);
    return { id: `be${posts.length}` } as never;
  });
  return { svc, posts, audit, ownerBalance, tx };
}

const BASE = {
  accountId: 'acct-1',
  sellerId: 's1',
  reason: 'Debt repaid from COD that stayed held for the seller',
  staffId: 'staff-1',
};

describe('BankLedgerService.reclassifySellerCash', () => {
  it("moves the seller's cash to capital as a pair summing to zero", async () => {
    const { svc, posts, audit } = makeSut('1455.00');
    const r = await svc.reclassifySellerCash({
      ...BASE,
      direction: 'TO_CAPITAL',
      amount: '743.60',
    });
    expect(r.entryIds).toHaveLength(2);
    expect(posts.map((p) => [p.owner.kind, p.signedAmount.toFixed(2), p.type])).toEqual([
      ['SELLER', '-743.60', 'RECLASSIFICATION'],
      ['CAPITAL', '743.60', 'RECLASSIFICATION'],
    ]);
    expect(posts.reduce((t, p) => t.add(p.signedAmount), new Prisma.Decimal(0)).isZero()).toBe(
      true,
    );
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ severity: 'HIGH' }));
  });

  it('takes the seller’s wallet lock before the account’s reconcile key', async () => {
    // Every wallet write holds the wallet lock while its attribution moves
    // this seller's cash; taken the other way round here, a correction and
    // a charge landing together could each hold one and wait for the other.
    const { svc, tx } = makeSut('1455.00');
    await svc.reclassifySellerCash({ ...BASE, direction: 'TO_CAPITAL', amount: '10.00' });
    expect(tx.$executeRaw.mock.calls.map((c) => c[1])).toEqual([
      AdvisoryLock.WALLET,
      AdvisoryLock.BANK_RECONCILE,
    ]);
    expect(tx.$executeRaw.mock.calls[1]?.[2]).toBe(advisoryKey(accountReconcileKey('acct-1')));
  });

  it('toward the seller in a taka account REQUIRES their rupee value, and carries it', async () => {
    // Valued at today's rate it moved what the book holds for them by the
    // rate's drift since they were credited, while their wallet stood still.
    const refused = makeSut('5000.00', 'BDT');
    await expect(
      refused.svc.reclassifySellerCash({ ...BASE, direction: 'TO_SELLER', amount: '1000' }),
    ).rejects.toMatchObject({ response: { code: 'INR_VALUE_REQUIRED' } });
    expect(refused.posts).toHaveLength(0);

    const { svc, posts, audit } = makeSut('5000.00', 'BDT');
    await svc.reclassifySellerCash({
      ...BASE,
      direction: 'TO_SELLER',
      amount: '1000',
      inrValue: '780',
    });
    expect(
      posts.map((p) => [p.owner.kind, p.signedAmount.toFixed(2), p.inrBookValue?.toFixed(2)]),
    ).toEqual([
      ['CAPITAL', '-1000.00', undefined],
      ['SELLER', '1000.00', '780.00'],
    ]);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ inrValue: '780.00' }) }),
    );
  });

  it('toward capital in a taka account the value is optional — their average by default', async () => {
    const { svc, posts } = makeSut('5000.00', 'BDT');
    await svc.reclassifySellerCash({ ...BASE, direction: 'TO_CAPITAL', amount: '100' });
    expect(posts[0]?.inrBookValue).toBeUndefined();
  });

  it('refuses a rupee value on a rupee account', async () => {
    const { svc } = makeSut('5000.00');
    await expect(
      svc.reclassifySellerCash({ ...BASE, direction: 'TO_SELLER', amount: '10', inrValue: '10' }),
    ).rejects.toMatchObject({ response: { code: 'INR_VALUE_NOT_APPLICABLE' } });
  });

  it('refuses to move more than the seller holds there', async () => {
    const { svc, posts } = makeSut('100.00');
    await expect(
      svc.reclassifySellerCash({ ...BASE, direction: 'TO_CAPITAL', amount: '743.60' }),
    ).rejects.toMatchObject({ response: { code: 'RECLASSIFY_EXCEEDS_HELD' } });
    expect(posts).toHaveLength(0);
  });

  it('the other way reads what CAPITAL holds, not the seller', async () => {
    const { svc, ownerBalance, posts } = makeSut('500.00');
    await svc.reclassifySellerCash({ ...BASE, direction: 'TO_SELLER', amount: '200.00' });
    expect(ownerBalance).toHaveBeenCalledWith('acct-1', { kind: 'CAPITAL' }, expect.anything());
    expect(posts.map((p) => [p.owner.kind, p.signedAmount.toFixed(2)])).toEqual([
      ['CAPITAL', '-200.00'],
      ['SELLER', '200.00'],
    ]);
  });

  it('refuses a short reason and a non-positive amount', async () => {
    const { svc } = makeSut('1000.00');
    await expect(
      svc.reclassifySellerCash({ ...BASE, reason: 'fix', direction: 'TO_CAPITAL', amount: '1' }),
    ).rejects.toMatchObject({ response: { code: 'BANK_REASON_TOO_SHORT' } });
    await expect(
      svc.reclassifySellerCash({ ...BASE, direction: 'TO_CAPITAL', amount: '0' }),
    ).rejects.toMatchObject({ response: { code: 'RECLASSIFY_AMOUNT_INVALID' } });
  });
});
