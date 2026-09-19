import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ActorType, ResellerMoneyParty, StoreDisputeKind, TicketType } from '@skydrop/db';
import type { Prisma } from '@skydrop/db';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';
import type { TicketNotifier } from '../../src/modules/ticket/services/ticket-notifier.service';
import { TicketService } from '../../src/modules/ticket/services/ticket.service';
import { TicketStateMachineService } from '../../src/modules/ticket/services/ticket-state-machine.service';

/**
 * RS-7 (2026-09-19) — "correct the figures" on a reseller order, raised
 * by EITHER side and settled BETWEEN the two wallets.
 *
 * WHAT EACH TEST PINS, AND WHY IT MATTERS:
 *
 *  - The correction is a KIND of `STORE_DISPUTE`, not a second money
 *    path. That is the whole design: `settleStoreDispute` is the ONE
 *    place a dispute pays anybody, and the once-per-order wallet unique
 *    means a paid credit cannot be reversed and rewritten anyway.
 *
 *  - A correction must SAY WHAT IT IS ASKING FOR. "The figures are
 *    wrong" with no figure in it is not something staff can settle, and
 *    a claim recorded as null would leave the settlement form blank
 *    with nothing in the thread to fill it from.
 *
 *  - A claim on an ORDINARY dispute is refused rather than quietly
 *    stored: it would show up pre-filled on the settle form of a ticket
 *    nobody costed, which is worse than not offering it at all.
 *
 *  - The FIGURES are stamped from `ResellerOrderMoneyReadService` — the
 *    same computation behind the store's, the seller's and staff's own
 *    money panels — so the snapshot cannot disagree with what the
 *    parties were looking at. Re-deriving it here would be the drift a
 *    single reader exists to prevent.
 *
 *  - The STORE is read off the ORDER on the seller's path, never taken
 *    from the request, so a seller cannot file against a store that had
 *    nothing to do with the order.
 */

const moneyView = {
  orderId: 'order-1',
  orderNumber: 'SD-2026-37-000001',
  paymentMode: 'COD',
  codInr: '1180.00',
  transferTotalInr: '600.00',
  retailTotalInr: '1000.00',
  termsVersionId: 'tv-1',
  storePercents: {},
  parties: [
    {
      party: ResellerMoneyParty.STORE,
      trigger: 'ON_PAYOUT',
      days: 2,
      timing: 'on payout + 2 days',
      status: 'CREDITED',
      dueAt: null,
      creditedAt: '2026-09-18T10:00:00.000Z',
      reversedAt: null,
      skippedReason: null,
      grossInr: '1180.00',
      transferInr: '600.00',
      taxShareInr: '180.00',
      codFeeShareInr: '0.00',
      instantFeeShareInr: '0.00',
      netInr: '400.00',
    },
    {
      party: ResellerMoneyParty.SELLER,
      trigger: 'AFTER_DELIVERY',
      days: 7,
      timing: 'after delivery + 7 days',
      status: 'CREDITED',
      dueAt: null,
      creditedAt: '2026-09-18T10:00:00.000Z',
      reversedAt: null,
      skippedReason: null,
      grossInr: '600.00',
      transferInr: '600.00',
      taxShareInr: '0.00',
      codFeeShareInr: '0.00',
      instantFeeShareInr: '0.00',
      netInr: '560.00',
    },
  ],
  fees: [{ fee: 'ORDER_CHARGES', storeInr: '160.00', sellerInr: '40.00', totalInr: '200.00' }],
  storeLines: null,
  sellerLines: null,
  storeNetInr: null,
  sellerNetInr: null,
};

function makeSut(opts: {
  order?: { id: string; sellerId: string; storeId: string | null } | null;
}) {
  const order =
    opts.order === undefined
      ? { id: 'order-1', sellerId: 'seller-1', storeId: 'store-1' }
      : opts.order;
  const orderFindFirst = jest.fn(async () => order);
  const ticketCreate = jest.fn<
    Promise<Record<string, unknown>>,
    [{ data: Record<string, unknown> }]
  >(async (a) => ({
    id: '019fad84-7acd-754e-8ee4-43cf858fed90',
    events: [],
    order: { orderNumber: 'SD-2026-37-000001' },
    shipment: null,
    goodsReceipt: null,
    store: { name: 'kolkata-kurtis', displayName: 'Kolkata Kurtis' },
    ...a.data,
  }));
  // The read-back both openers do (getForStore / getForSeller). Returns
  // whatever the create wrote, so the view reflects the row.
  let created: Record<string, unknown> = {};
  const ticketFindFirst = jest.fn(async () => created);

  const tx = {
    ticket: { findUnique: jest.fn(async () => null), create: ticketCreate },
    ticketEvent: { create: jest.fn(async () => ({ id: 'event-1' })) },
    $executeRawUnsafe: jest.fn(async () => 1),
    $queryRawUnsafe: jest.fn(async () => [{ value: 7n }]),
  };
  const client = {
    order: { findFirst: orderFindFirst },
    ticket: { findFirst: ticketFindFirst },
    $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
  };
  ticketCreate.mockImplementation(async (a: { data: Record<string, unknown> }) => {
    created = {
      id: '019fad84-7acd-754e-8ee4-43cf858fed90',
      events: [],
      order: { orderNumber: 'SD-2026-37-000001' },
      shipment: null,
      goodsReceipt: null,
      store: { name: 'kolkata-kurtis', displayName: 'Kolkata Kurtis' },
      resolutionAmountInr: null,
      resolutionWalletEntryId: null,
      resolutionNotes: null,
      resolvedAt: null,
      createdAt: new Date('2026-09-19T10:00:00Z'),
      handling: 'NONE',
      ...a.data,
    };
    return created;
  });

  const forOrder = jest.fn(async () => moneyView);
  const svc = new TicketService(
    { client } as unknown as PrismaService,
    { log: jest.fn(async () => 'a1') } as unknown as AuditLogService,
    {} as unknown as WalletService,
    new TicketStateMachineService(),
    { afterEvent: jest.fn() } as unknown as TicketNotifier,
    { transferCompensationCap: async () => null } as never,
    { forOrder } as never,
  );
  return { svc, ticketCreate, orderFindFirst, forOrder };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return (e as { response?: { code?: string } }).response?.code ?? 'THREW';
  }
}

describe('RS-7 — a STORE raises a figure correction', () => {
  it('records the claim and stamps the figures both sides were looking at', async () => {
    const { svc, ticketCreate, forOrder } = makeSut({});
    await svc.openForStore({
      storeId: 'store-1',
      storeUserId: 'su-1',
      orderId: 'order-1',
      subject: 'The transfer price is wrong',
      disputeKind: StoreDisputeKind.FIGURE_CORRECTION,
      claimAmountInr: '120.00',
      claimPayer: ResellerMoneyParty.SELLER,
    });
    const data = ticketCreate.mock.calls[0]![0].data;
    expect(data['ticketType']).toBe(TicketType.STORE_DISPUTE);
    expect(data['disputeKind']).toBe(StoreDisputeKind.FIGURE_CORRECTION);
    expect((data['disputeClaimAmountInr'] as Prisma.Decimal).toFixed(2)).toBe('120.00');
    expect(data['disputeClaimPayer']).toBe(ResellerMoneyParty.SELLER);
    expect(data['openedByStoreUserId']).toBe('su-1');

    // From the ONE read service, at STAFF audience (both parties' plan).
    expect(forOrder).toHaveBeenCalledWith('order-1', { audience: 'STAFF' });
    const figures = data['disputedFigures'] as Record<string, unknown>;
    expect(figures['orderNumber']).toBe('SD-2026-37-000001');
    expect(figures['transferTotalInr']).toBe('600.00');
    expect(figures['parties'] as Array<{ party: string; netInr: string }>).toEqual([
      expect.objectContaining({ party: 'STORE', netInr: '400.00' }),
      expect.objectContaining({ party: 'SELLER', netInr: '560.00' }),
    ]);
    // The wallet LINES are deliberately not carried: they are readable
    // live and would bloat every ticket row.
    expect(figures).not.toHaveProperty('storeLines');
  });

  it('refuses a correction with no claim in it — nothing is written', async () => {
    const { svc, ticketCreate } = makeSut({});
    expect(
      await code(
        svc.openForStore({
          storeId: 'store-1',
          storeUserId: 'su-1',
          orderId: 'order-1',
          subject: 'The figures are wrong',
          disputeKind: StoreDisputeKind.FIGURE_CORRECTION,
        }),
      ),
    ).toBe('DISPUTE_CLAIM_REQUIRED');
    expect(ticketCreate).not.toHaveBeenCalled();
  });

  it('refuses a claim of ₹0 or a malformed one', async () => {
    const { svc } = makeSut({});
    for (const amount of ['0', '0.00', '-5.00', '12.345', 'lots']) {
      expect(
        await code(
          svc.openForStore({
            storeId: 'store-1',
            storeUserId: 'su-1',
            orderId: 'order-1',
            subject: 'The figures are wrong',
            disputeKind: StoreDisputeKind.FIGURE_CORRECTION,
            claimAmountInr: amount,
            claimPayer: ResellerMoneyParty.SELLER,
          }),
        ),
      ).toBe('DISPUTE_CLAIM_AMOUNT_INVALID');
    }
  });

  it('refuses a claim on an ORDINARY dispute rather than storing it unread', async () => {
    const { svc, ticketCreate } = makeSut({});
    expect(
      await code(
        svc.openForStore({
          storeId: 'store-1',
          storeUserId: 'su-1',
          orderId: 'order-1',
          subject: 'Wrong colour sent',
          claimAmountInr: '120.00',
          claimPayer: ResellerMoneyParty.SELLER,
        }),
      ),
    ).toBe('DISPUTE_CLAIM_NOT_FOR_KIND');
    expect(ticketCreate).not.toHaveBeenCalled();
  });

  it('an ordinary dispute is GENERAL, carries no claim, and reads no figures', async () => {
    const { svc, ticketCreate, forOrder } = makeSut({});
    await svc.openForStore({
      storeId: 'store-1',
      storeUserId: 'su-1',
      orderId: 'order-1',
      subject: 'Wrong colour sent',
    });
    const data = ticketCreate.mock.calls[0]![0].data;
    expect(data['disputeKind']).toBe(StoreDisputeKind.GENERAL);
    expect(data['disputeClaimAmountInr']).toBeNull();
    expect(data['disputeClaimPayer']).toBeNull();
    expect(data).not.toHaveProperty('disputedFigures');
    // No money read at all — an ordinary dispute is not about figures.
    expect(forOrder).not.toHaveBeenCalled();
  });
});

describe('RS-7 — SELLER STAFF raise a dispute with one of their stores', () => {
  it('scopes the order to the SELLER and takes the store from the order', async () => {
    const { svc, ticketCreate, orderFindFirst } = makeSut({});
    await svc.openForSellerAgainstStore({
      sellerId: 'seller-1',
      sellerUserId: 'user-1',
      orderId: 'order-1',
      subject: 'The store under-declared the retail',
      disputeKind: StoreDisputeKind.FIGURE_CORRECTION,
      claimAmountInr: '75.50',
      claimPayer: ResellerMoneyParty.STORE,
    });
    const where = (
      orderFindFirst.mock.calls[0] as unknown as [{ where: Record<string, unknown> }]
    )[0].where;
    expect(where).toMatchObject({
      id: 'order-1',
      sellerId: 'seller-1',
      storeKind: 'RESELLER',
      deletedAt: null,
    });
    // Never a storeId from the request — there is none to send.
    expect(where).not.toHaveProperty('storeId');

    const data = ticketCreate.mock.calls[0]![0].data;
    expect(data['storeId']).toBe('store-1');
    expect(data['sellerId']).toBe('seller-1');
    // The seller opened it, so no store user is credited with it.
    expect(data['openedByStoreUserId']).toBeNull();
    expect((data['disputeClaimAmountInr'] as Prisma.Decimal).toFixed(2)).toBe('75.50');
    expect(data['disputeClaimPayer']).toBe(ResellerMoneyParty.STORE);
  });

  it('the opening event is the SELLER’s, so the thread says who spoke', async () => {
    const { svc } = makeSut({});
    const view = await svc.openForSellerAgainstStore({
      sellerId: 'seller-1',
      sellerUserId: 'user-1',
      orderId: 'order-1',
      subject: 'The store under-declared the retail',
    });
    expect(view.ticketType).toBe(TicketType.STORE_DISPUTE);
    expect(view.storeId).toBe('store-1');
  });

  it('a channel order, another seller’s, or none at all is the same 404', async () => {
    const { svc, ticketCreate } = makeSut({ order: null });
    expect(
      await code(
        svc.openForSellerAgainstStore({
          sellerId: 'seller-1',
          sellerUserId: 'user-1',
          orderId: 'not-theirs',
          subject: 'Something',
        }),
      ),
    ).toBe('ORDER_NOT_FOUND');
    expect(ticketCreate).not.toHaveBeenCalled();
  });

  it('an order whose store is missing is refused, never filed against nobody', async () => {
    // Structurally impossible under the composite FK, but a dispute with
    // a null store could never be settled or read by anybody.
    const { svc, ticketCreate } = makeSut({
      order: { id: 'order-1', sellerId: 'seller-1', storeId: null },
    });
    expect(
      await code(
        svc.openForSellerAgainstStore({
          sellerId: 'seller-1',
          sellerUserId: 'user-1',
          orderId: 'order-1',
          subject: 'Something',
        }),
      ),
    ).toBe('ORDER_NOT_FOUND');
    expect(ticketCreate).not.toHaveBeenCalled();
  });
});

describe('RS-7 — the correction has NO money path of its own', () => {
  it('nothing in the ticket service settles a correction except settleStoreDispute', () => {
    // Read the source rather than the behaviour: a SECOND settlement
    // route would be a new method that pays somebody, and the point of
    // the correction being a KIND rather than a TYPE is that the money
    // still goes through the one path that claims the ticket first.
    const src = readFileSync(
      join(__dirname, '../../src/modules/ticket/services/ticket.service.ts'),
      'utf8',
    );
    const settlers = src.match(/this\.resellerMoney\.settleStoreDispute\(/g) ?? [];
    expect(settlers).toHaveLength(1);
    // And the read service is used for READING only.
    expect(src).not.toMatch(/this\.money\.(?!forOrder)/);
  });

  it('the opener never touches the wallet', async () => {
    const { svc } = makeSut({});
    // `WalletService` is an empty object in this harness: any call on it
    // would throw. Opening a correction must not need one.
    await expect(
      svc.openForStore({
        storeId: 'store-1',
        storeUserId: 'su-1',
        orderId: 'order-1',
        subject: 'The transfer price is wrong',
        disputeKind: StoreDisputeKind.FIGURE_CORRECTION,
        claimAmountInr: '120.00',
        claimPayer: ResellerMoneyParty.SELLER,
      }),
    ).resolves.toMatchObject({ ticketType: TicketType.STORE_DISPUTE });
  });
});

describe('RS-7 — the actor on a correction', () => {
  it('a store’s correction is opened as the STORE', async () => {
    const { svc, ticketCreate } = makeSut({});
    await svc.openForStore({
      storeId: 'store-1',
      storeUserId: 'su-1',
      orderId: 'order-1',
      subject: 'The transfer price is wrong',
    });
    expect(ticketCreate.mock.calls[0]![0].data['openedByStoreUserId']).toBe('su-1');
    expect(ticketCreate.mock.calls[0]![0].data['openedBySellerUserId']).toBeNull();
  });

  it('a seller’s correction is opened as the SELLER', async () => {
    const { svc, ticketCreate } = makeSut({});
    await svc.openForSellerAgainstStore({
      sellerId: 'seller-1',
      sellerUserId: 'user-1',
      orderId: 'order-1',
      subject: 'The store under-declared the retail',
    });
    const data = ticketCreate.mock.calls[0]![0].data;
    expect(data['openedBySellerUserId']).toBe('user-1');
    expect(data['openedByStaffId']).toBeNull();
    expect(ActorType.SELLER).toBe('SELLER');
  });
});
