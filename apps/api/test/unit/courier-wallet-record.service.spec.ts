import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { CourierRechargeMatch, Prisma } from '@skydrop/db';
import { CourierWalletRecordService } from '../../src/modules/courier-wallet/services/courier-wallet-record.service';

/**
 * The two halves of the loop a person closes by hand.
 *
 * The interesting cases are all about NOT letting the same money be
 * recorded twice and not letting an awkward figure be made to disappear
 * quietly — the reconciliation is only worth having if the answers to it
 * are as hard to fake as the question.
 */
function make(
  recharge: Record<string, unknown> | null = {
    id: 'rc-1',
    courierAccountId: 'ca-1',
    externalTxnId: 'MRC123',
    bankTxnRef: 'UTR999',
    amountInr: new Prisma.Decimal('20000.00'),
    occurredAt: new Date('2026-09-01T00:00:00Z'),
    bankEntryId: null,
    courierAccount: { label: 'Delhivery — main' },
  },
) {
  const updateMany = jest.fn(async () => ({ count: 1 }));
  const update = jest.fn(async () => ({}));
  const findUnique = jest.fn(async () => recharge);
  const findFirst = jest.fn(async () => ({ id: 'ca-1', label: 'Delhivery — main' }));

  const tx = {
    courierWalletRecharge: { updateMany, update },
  };
  const prisma = {
    client: {
      courierWalletRecharge: { findUnique, updateMany },
      courierAccount: { findFirst },
      $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
    },
  };

  // Typed with its argument so `mock.calls[0][0]` is the input rather
  // than a zero-length tuple.
  const post = jest.fn(async (_input: Record<string, unknown>) => ({ id: 'be-1' }));
  const log = jest.fn(async (_input: Record<string, unknown>) => undefined);
  const resolveByKey = jest.fn(async () => 1);

  const svc = new CourierWalletRecordService(
    prisma as never,
    { post } as never,
    { log } as never,
    { resolveByKey } as never,
  );
  return { svc, post, log, resolveByKey, updateMany, update, findUnique };
}

describe('CourierWalletRecordService.recordBankSide', () => {
  it('posts the bank side NEGATIVE, as capital, on the courier’s own date', async () => {
    const { svc, post } = make();
    await svc.recordBankSide({ rechargeId: 'rc-1', bankAccountId: 'ba-1', staffId: 'st-1' });

    const call = post.mock.calls[0]?.[0] as unknown as {
      signedAmount: Prisma.Decimal;
      owner: { kind: string };
      occurredAt: Date;
      reference: string | null;
      actorType: string;
      staffId: string;
    };
    // Money LEFT the account, so it is negative. It has not left the
    // business — the treasury overview counts the wallet as an asset.
    expect(call.signedAmount.toFixed(2)).toBe('-20000.00');
    // Ours. Attributing it to a seller would move held cash for a
    // payment that seller did not make.
    expect(call.owner.kind).toBe('CAPITAL');
    // Their date, not today: a statement line from Tuesday belongs on
    // Tuesday.
    expect(call.occurredAt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    // Their reference, not one somebody retyped.
    expect(call.reference).toBe('UTR999');
    expect(call.actorType).toBe('STAFF');
    expect(call.staffId).toBe('st-1');
  });

  it('links the entry in the SAME transaction that posts it', async () => {
    // An entry existing for a recharge it did not get linked to reads on
    // the next sweep as a second unrecorded payment.
    const { svc, update } = make();
    await svc.recordBankSide({ rechargeId: 'rc-1', bankAccountId: 'ba-1', staffId: 'st-1' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { bankEntryId: 'be-1', matchState: CourierRechargeMatch.MATCHED },
      }),
    );
  });

  it('refuses a recharge that already has a bank entry', async () => {
    const { svc, post } = make({
      id: 'rc-1',
      courierAccountId: 'ca-1',
      externalTxnId: 'MRC123',
      bankTxnRef: 'UTR999',
      amountInr: new Prisma.Decimal('20000.00'),
      occurredAt: new Date(),
      bankEntryId: 'be-existing',
      courierAccount: { label: 'x' },
    });
    await expect(
      svc.recordBankSide({ rechargeId: 'rc-1', bankAccountId: 'ba-1', staffId: 'st-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
    // And crucially: no money was written on the way to refusing.
    expect(post).not.toHaveBeenCalled();
  });

  it('loses the race safely — the claim is guarded, not the read', async () => {
    // Two operators on two screens both read "not recorded". Only one
    // may write the money; the other must not post a second entry.
    const { svc, updateMany, post } = make();
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      svc.recordBankSide({ rechargeId: 'rc-1', bankAccountId: 'ba-1', staffId: 'st-2' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(post).not.toHaveBeenCalled();
  });

  it('answers the system issue it was raised for, naming who answered it', async () => {
    const { svc, resolveByKey } = make();
    await svc.recordBankSide({ rechargeId: 'rc-1', bankAccountId: 'ba-1', staffId: 'st-1' });
    expect(resolveByKey).toHaveBeenCalledWith(
      'courier-recharge-unrecorded:ca-1:MRC123',
      'Bank side recorded',
      'st-1',
    );
  });

  it('404s on a recharge that is not there', async () => {
    const { svc } = make(null);
    await expect(
      svc.recordBankSide({ rechargeId: 'nope', bankAccountId: 'ba-1', staffId: 'st-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CourierWalletRecordService.resolveWithoutPayment', () => {
  it('demands a real reason', async () => {
    const { svc } = make();
    await expect(
      svc.resolveWithoutPayment({ rechargeId: 'rc-1', staffId: 'st-1', reason: 'credit note' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writes NO bank entry — there is no money of ours behind it', async () => {
    // Inventing one to tidy the row would put a figure in the bank book
    // that no statement will ever agree with.
    const { svc, post } = make();
    await svc.resolveWithoutPayment({
      rechargeId: 'rc-1',
      staffId: 'st-1',
      reason: 'Promotional credit Delhivery applied to the account themselves',
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('audits HIGH, with the reason on the row', async () => {
    const { svc, log } = make();
    const reason = 'Promotional credit Delhivery applied to the account themselves';
    await svc.resolveWithoutPayment({ rechargeId: 'rc-1', staffId: 'st-1', reason });
    const entry = log.mock.calls[0]?.[0] as unknown as {
      severity: string;
      metadata: { reason: string };
    };
    expect(entry.severity).toBe('HIGH');
    expect(entry.metadata.reason).toBe(reason);
  });

  it('refuses to explain away one that HAS a payment behind it', async () => {
    const { svc } = make({
      id: 'rc-1',
      courierAccountId: 'ca-1',
      externalTxnId: 'MRC123',
      amountInr: new Prisma.Decimal('20000.00'),
      bankEntryId: 'be-existing',
    });
    await expect(
      svc.resolveWithoutPayment({
        rechargeId: 'rc-1',
        staffId: 'st-1',
        reason: 'This one was definitely not ours at all, honestly',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('CourierWalletRecordService.recordOutgoingPayment', () => {
  it('refuses a payment with no bank reference', async () => {
    // The reference is the ONLY thing the two sides are matched on. A
    // payment recorded without one can never be tied to their recharge,
    // so it would be flagged as missing forever.
    const { svc } = make();
    await expect(
      svc.recordOutgoingPayment({
        bankAccountId: 'ba-1',
        courierAccountId: 'ca-1',
        amountInr: '20000.00',
        occurredAt: new Date(),
        reference: '   ',
        staffId: 'st-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a zero or negative amount', async () => {
    const { svc } = make();
    await expect(
      svc.recordOutgoingPayment({
        bankAccountId: 'ba-1',
        courierAccountId: 'ca-1',
        amountInr: '0',
        occurredAt: new Date(),
        reference: 'UTR1',
        staffId: 'st-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('posts it negative and capital, like the matched path', async () => {
    const { svc, post } = make();
    await svc.recordOutgoingPayment({
      bankAccountId: 'ba-1',
      courierAccountId: 'ca-1',
      amountInr: '20000.00',
      occurredAt: new Date('2026-09-02T00:00:00Z'),
      reference: ' UTR777 ',
      staffId: 'st-1',
    });
    const call = post.mock.calls[0]?.[0] as unknown as {
      signedAmount: Prisma.Decimal;
      owner: { kind: string };
      reference: string;
    };
    expect(call.signedAmount.toFixed(2)).toBe('-20000.00');
    expect(call.owner.kind).toBe('CAPITAL');
    // Trimmed, because a trailing space is a reference that never matches.
    expect(call.reference).toBe('UTR777');
  });
});

describe('CourierWalletRecordService.recordOutgoingPayment — idempotent on the client key', () => {
  const KEY = '9f0b1a52-2f6b-4d4e-8d8c-6d1c0a6e7b31';
  const PAYMENT = {
    bankAccountId: 'ba-1',
    courierAccountId: 'ca-1',
    amountInr: '20000.00',
    occurredAt: new Date('2026-09-01T00:00:00Z'),
    reference: 'UTR999',
    staffId: 'st-1',
    idempotencyKey: KEY,
  };

  function makeKeyed(prior: Array<Record<string, unknown> | null>, postThrows?: unknown) {
    const queue = [...prior];
    const post = jest.fn(async (_i: Record<string, unknown>) => {
      if (postThrows !== undefined) throw postThrows;
      return { id: 'be-new' };
    });
    const svc = new CourierWalletRecordService(
      {
        client: {
          courierAccount: { findFirst: jest.fn(async () => ({ id: 'ca-1', label: 'Delhivery' })) },
          bankEntry: { findUnique: jest.fn(async () => queue.shift() ?? null) },
        },
      } as never,
      { post } as never,
      { log: jest.fn(async () => undefined) } as never,
      { resolveByKey: jest.fn(async () => 1) } as never,
    );
    return { svc, post };
  }

  it('posts the key with the entry', async () => {
    const { svc, post } = makeKeyed([null]);
    await svc.recordOutgoingPayment(PAYMENT);
    expect(post.mock.calls[0]![0]).toMatchObject({ idempotencyKey: KEY });
  });

  it('a replay books nothing and returns the original entry', async () => {
    const { svc, post } = makeKeyed([{ id: 'be-first', type: 'COURIER_WALLET_RECHARGE' }]);
    await expect(svc.recordOutgoingPayment(PAYMENT)).resolves.toEqual({
      bankEntryId: 'be-first',
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('two copies racing: the loser answers with the winner’s entry', async () => {
    const { svc } = makeKeyed(
      [null, { id: 'be-first', type: 'COURIER_WALLET_RECHARGE' }],
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(svc.recordOutgoingPayment(PAYMENT)).resolves.toEqual({
      bankEntryId: 'be-first',
    });
  });

  it('refuses a key that posted something else', async () => {
    const { svc } = makeKeyed([{ id: 'be-x', type: 'EXPENSE' }]);
    await expect(svc.recordOutgoingPayment(PAYMENT)).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
  });
});
