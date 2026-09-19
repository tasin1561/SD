import { ActorType, Prisma, ResellerMoneyParty, TicketStatus, TicketType } from '@skydrop/db';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';
import type { TicketNotifier } from '../../src/modules/ticket/services/ticket-notifier.service';
import { TicketService } from '../../src/modules/ticket/services/ticket.service';
import { TicketStateMachineService } from '../../src/modules/ticket/services/ticket-state-machine.service';

/**
 * RS-7 — a reseller store's dispute with its seller, refereed by us.
 *
 * What each test pins, because each failure is silent:
 *  - a settlement moves money BETWEEN the store and the seller (the pair
 *    `ResellerOrderMoneyService.settleStoreDispute` writes), never from us;
 *    the ordinary refund on that ticket type is refused;
 *  - the status is CLAIMED before any money moves, so two concurrent
 *    settlements pay once (the TKT-1 double-refund lesson);
 *  - goods lost in our hands on a reseller order are compensated at the
 *    TRANSFER price at most, never the store's retail;
 *  - a store can only raise a dispute on its OWN reseller order.
 */

const machine = new TicketStateMachineService();
/** A status from which a ticket may be settled — asked of the real machine. */
const SETTLEABLE = (Object.values(TicketStatus) as TicketStatus[]).find((s) =>
  machine.canTransition(s, TicketStatus.RESOLVED_REFUND),
);

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '019fad84-7acd-754e-8ee4-43cf858fed90',
  ticketNumber: 'TK-2026-000042',
  openedByStaffId: null,
  openedBySellerUserId: null,
  openedByStoreUserId: 'store-user-1',
  events: [{ actorType: ActorType.STORE }],
  issueCategoryExternalId: null,
  issueSubcategoryExternalId: null,
  ticketType: TicketType.STORE_DISPUTE,
  status: SETTLEABLE,
  sellerId: 'seller-1',
  orderId: 'order-1',
  order: { orderNumber: 'SD-2026-37-000001' },
  shipmentId: null,
  shipment: null,
  shipmentItemId: null,
  courierCode: null,
  goodsReceiptId: null,
  goodsReceipt: null,
  subject: 'Wrong colour sent',
  description: null,
  resolutionAmountInr: null,
  resolutionWalletEntryId: null,
  resolutionNotes: null,
  resolvedAt: null,
  createdAt: new Date('2026-09-15T10:00:00Z'),
  storeId: 'store-1',
  store: { name: 'kolkata-kurtis', displayName: 'Kolkata Kurtis' },
  disputePayer: null,
  ...over,
});

function makeSut(opts: {
  ticket?: Record<string, unknown> | null;
  claimed?: number;
  cap?: Prisma.Decimal | null;
  order?: { id: string; sellerId: string } | null;
}) {
  const settle = jest.fn(async () => ({
    sellerEntryId: 'seller-entry-1',
    storeEntryId: 'store-entry-1',
  }));
  const cap = jest.fn(async () => opts.cap ?? null);
  const updateMany = jest.fn(async () => ({ count: opts.claimed ?? 1 }));
  const update = jest.fn(async (a: { data: Record<string, unknown> }) => ({
    ...(opts.ticket ?? row()),
    ...a.data,
    status: TicketStatus.RESOLVED_REFUND,
  }));
  const eventCreate = jest.fn(async () => ({ id: 'event-1' }));
  const auditLog = jest.fn(async () => 'a1');
  const tx = {
    ticket: { updateMany, update },
    ticketEvent: { create: eventCreate },
  };
  const orderFindFirst = jest.fn(async () => opts.order ?? null);
  const client = {
    ticket: { findUnique: jest.fn(async () => (opts.ticket === undefined ? row() : opts.ticket)) },
    order: { findFirst: orderFindFirst },
    $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
  };
  const svc = new TicketService(
    { client } as unknown as PrismaService,
    { log: auditLog } as unknown as AuditLogService,
    {
      applyEntry: jest.fn(),
      recomputeCacheAfterCommit: jest.fn(async () => undefined),
    } as unknown as WalletService,
    machine,
    { afterEvent: jest.fn() } as unknown as TicketNotifier,
    { settleStoreDispute: settle, transferCompensationCap: cap } as never,
    // RS-7 (2026-09-19) — the figures a FIGURE_CORRECTION stamps.
    { forOrder: jest.fn() } as never,
  );
  return { svc, settle, cap, updateMany, update, eventCreate, auditLog, orderFindFirst };
}

describe('RS-7 — settling a store dispute moves money between the store and the seller', () => {
  it('has a status from which a ticket can be settled', () => {
    expect(SETTLEABLE).toBeDefined();
  });

  it('the store pays the seller: the pair is written, the ticket records who paid, audited HIGH', async () => {
    const { svc, settle, update, auditLog } = makeSut({});
    const view = await svc.settleStoreDispute(
      '019fad84-7acd-754e-8ee4-43cf858fed90',
      { amountInr: '450.50', payer: ResellerMoneyParty.STORE, notes: 'Store agreed on the call' },
      'staff-1',
    );
    expect(settle).toHaveBeenCalledTimes(1);
    const call = (settle.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(call).toMatchObject({
      storeId: 'store-1',
      sellerId: 'seller-1',
      orderId: 'order-1',
      payer: ResellerMoneyParty.STORE,
      ticketNumber: 'TK-2026-000042',
      staffId: 'staff-1',
    });
    expect((call['amount'] as Prisma.Decimal).toFixed(2)).toBe('450.50');
    const data = (update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data).toMatchObject({
      resolutionWalletEntryId: 'seller-entry-1',
      resolutionStoreEntryId: 'store-entry-1',
      disputePayer: ResellerMoneyParty.STORE,
    });
    expect(view.disputePayer).toBe(ResellerMoneyParty.STORE);
    expect(view.storeName).toBe('Kolkata Kurtis');
    const audit = (auditLog.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(audit).toMatchObject({ action: 'ticket.store_dispute_settled', severity: 'HIGH' });
  });

  it('a second concurrent settlement loses the claim and moves NO money', async () => {
    const { svc, settle } = makeSut({ claimed: 0 });
    await expect(
      svc.settleStoreDispute(
        'id',
        { amountInr: '100', payer: ResellerMoneyParty.SELLER },
        'staff-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'TICKET_ALREADY_MOVED' } });
    expect(settle).not.toHaveBeenCalled();
  });

  it.each(['0', '0.00', '-5', '1.234', 'abc'])(
    'refuses the amount %s before anything moves',
    async (amountInr) => {
      const { svc, settle, updateMany } = makeSut({});
      await expect(
        svc.settleStoreDispute('id', { amountInr, payer: ResellerMoneyParty.STORE }, 'staff-1'),
      ).rejects.toMatchObject({ response: { code: 'SETTLEMENT_AMOUNT_INVALID' } });
      expect(updateMany).not.toHaveBeenCalled();
      expect(settle).not.toHaveBeenCalled();
    },
  );

  it('refuses a ticket that is not a store dispute', async () => {
    const { svc, settle } = makeSut({
      ticket: row({ ticketType: TicketType.SELLER_RAISED_ISSUE, storeId: null }),
    });
    await expect(
      svc.settleStoreDispute('id', { amountInr: '10', payer: ResellerMoneyParty.STORE }, 'staff-1'),
    ).rejects.toMatchObject({ response: { code: 'TICKET_NOT_A_STORE_DISPUTE' } });
    expect(settle).not.toHaveBeenCalled();
  });

  it('the ordinary refund (our money) is refused on a store dispute', async () => {
    const { svc, updateMany } = makeSut({});
    await expect(
      svc.transition('id', { to: TicketStatus.RESOLVED_REFUND, refundAmountInr: '100' } as never, {
        type: ActorType.STAFF,
        staffId: 'staff-1',
      }),
    ).rejects.toMatchObject({ response: { code: 'STORE_DISPUTE_USE_SETTLEMENT' } });
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('RS-7 — goods lost in our hands on a reseller order: at most the TRANSFER price', () => {
  it('a refund above the transfer price is refused, naming the cap', async () => {
    const { svc, updateMany, cap } = makeSut({
      ticket: row({ ticketType: TicketType.SCRAP_DAMAGE, storeId: null, shipmentItemId: 'si-1' }),
      cap: new Prisma.Decimal('700'),
    });
    await expect(
      svc.transition(
        'id',
        { to: TicketStatus.RESOLVED_REFUND, refundAmountInr: '700.01' } as never,
        { type: ActorType.STAFF, staffId: 'staff-1' },
      ),
    ).rejects.toMatchObject({ response: { code: 'REFUND_ABOVE_TRANSFER_PRICE' } });
    expect(cap).toHaveBeenCalledWith(expect.anything(), {
      orderId: 'order-1',
      shipmentItemId: 'si-1',
    });
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('RS-7 — a store raises a dispute only on its own reseller order', () => {
  it('another store’s order, a channel order or none at all is the same 404, and nothing is opened', async () => {
    const { svc, orderFindFirst } = makeSut({ order: null });
    await expect(
      svc.openForStore({
        storeId: 'store-1',
        storeUserId: 'store-user-1',
        orderId: 'someone-elses',
        subject: 'Wrong colour sent',
      }),
    ).rejects.toMatchObject({ response: { code: 'ORDER_NOT_FOUND' } });
    const where = (
      orderFindFirst.mock.calls[0] as unknown as [{ where: Record<string, unknown> }]
    )[0].where;
    expect(where).toMatchObject({ id: 'someone-elses', storeId: 'store-1', storeKind: 'RESELLER' });
  });
});
