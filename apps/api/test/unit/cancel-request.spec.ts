import { OrderStatus, ResellerStoreActionMode, StoreOrderScope, TicketStatus } from '@skydrop/db';
import {
  CANCEL_REQUEST_STATUSES,
  isCancelRequestEligible,
} from '../../src/modules/cancel-request/cancel-request.rules';
import { CancelRequestReadService } from '../../src/modules/cancel-request/cancel-request-read.service';
import { SELLER_CANCELLABLE_STATES } from '../../src/modules/order/services/order-write.service';
import { CancelRequestService } from '../../src/modules/ticket/services/cancel-request.service';
import type { TicketService } from '../../src/modules/ticket/services/ticket.service';
import type { ResellerStoreActionPolicyService } from '../../src/modules/reseller-store/services/reseller-store-action-policy.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

describe('cancel request: which statuses offer it', () => {
  const offered: OrderStatus[] = [
    OrderStatus.PACKED,
    OrderStatus.PENDING_DISPATCH,
    OrderStatus.DISPATCHED,
    OrderStatus.IN_TRANSIT,
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.DELIVERY_FAILED,
  ];
  it.each(Object.values(OrderStatus))('%s', (status) => {
    expect(isCancelRequestEligible(status)).toBe(offered.includes(status));
  });
  it('never overlaps the direct-cancel window', () => {
    for (const s of CANCEL_REQUEST_STATUSES) expect(SELLER_CANCELLABLE_STATES.has(s)).toBe(false);
  });
});

describe('CancelRequestReadService.viewFor', () => {
  const find = jest.fn();
  const svc = new CancelRequestReadService({
    client: { ticket: { findFirst: find } },
  } as unknown as PrismaService);
  beforeEach(() => find.mockReset());

  it('is unavailable (and reads nothing) for a status outside the window', async () => {
    await expect(svc.viewFor({ id: 'o', status: OrderStatus.DELIVERED })).resolves.toEqual({
      available: false,
      openTicket: null,
    });
    expect(find).not.toHaveBeenCalled();
  });
  it('is unavailable when the caller disallows it (store policy OFF)', async () => {
    await expect(svc.viewFor({ id: 'o', status: OrderStatus.IN_TRANSIT }, false)).resolves.toEqual({
      available: false,
      openTicket: null,
    });
  });
  it('carries the open ticket so the button is disabled', async () => {
    find.mockResolvedValue({ id: 't1', ticketNumber: 'TK-2026-000009' });
    await expect(svc.viewFor({ id: 'o', status: OrderStatus.IN_TRANSIT })).resolves.toEqual({
      available: true,
      openTicket: { id: 't1', number: 'TK-2026-000009' },
    });
    expect(find.mock.calls[0]?.[0].where.status.in).toEqual([
      TicketStatus.OPEN,
      TicketStatus.NEGOTIATING,
    ]);
  });
  it('is available again once no ticket is open', async () => {
    find.mockResolvedValue(null);
    await expect(svc.viewFor({ id: 'o', status: OrderStatus.PACKED })).resolves.toEqual({
      available: true,
      openTicket: null,
    });
  });
});

interface FakeTicket {
  id: string;
  ticketNumber: string;
  orderId: string;
  status: TicketStatus;
}

describe('CancelRequestService.raise', () => {
  const SELLER = { kind: 'SELLER', sellerId: 's1', sellerUserId: 'u1' } as const;
  const STORE = {
    kind: 'STORE',
    storeId: 'st',
    storeUserId: 'su',
    orderScope: StoreOrderScope.ALL,
  } as const;

  function make(opts: {
    orderFound?: boolean;
    status?: OrderStatus;
    cancelPolicy?: ResellerStoreActionMode;
  }) {
    const tickets: FakeTicket[] = [];
    // A fake advisory lock: transactions run one at a time, which is what
    // pg_advisory_xact_lock gives two requests for the same order.
    let chain: Promise<unknown> = Promise.resolve();
    const tx = {
      $executeRaw: jest.fn(async () => 1),
      ticket: {
        findFirst: jest.fn(
          async ({ where }: { where: { orderId: string; status: { in: TicketStatus[] } } }) =>
            tickets.find(
              (t) => t.orderId === where.orderId && where.status.in.includes(t.status),
            ) ?? null,
        ),
      },
      order: {
        findUnique: jest.fn(async () => ({ status: opts.status ?? OrderStatus.IN_TRANSIT })),
      },
    };
    const prisma = {
      client: {
        order: {
          findFirst: jest.fn(async () =>
            opts.orderFound === false ? null : { id: 'o1', sellerId: 's1', orderNumber: 'SD-1' },
          ),
        },
        $transaction: (fn: (t: typeof tx) => Promise<unknown>) => {
          const run = chain.then(() => fn(tx));
          chain = run.catch(() => undefined);
          return run;
        },
      },
    } as unknown as PrismaService;
    const openOrFind = jest.fn(async (input: Record<string, unknown>) => {
      await new Promise((r) => setImmediate(r));
      const t: FakeTicket = {
        id: `t${tickets.length + 1}`,
        ticketNumber: `TK-2026-00000${tickets.length + 1}`,
        orderId: input['orderId'] as string,
        status: TicketStatus.OPEN,
      };
      tickets.push(t);
      return { created: true, ticket: t };
    });
    const policies = {
      forStore: jest.fn(async () => ({
        cancel: opts.cancelPolicy ?? ResellerStoreActionMode.DIRECT,
      })),
    };
    const svc = new CancelRequestService(
      prisma,
      { openOrFind } as unknown as TicketService,
      policies as unknown as ResellerStoreActionPolicyService,
    );
    return { svc, tickets, openOrFind };
  }

  it('opens a cancel-category ticket with the fixed reason plus the note', async () => {
    const { svc, openOrFind } = make({});
    const res = await svc.raise(SELLER, 'o1', 'customer called');
    expect(res.created).toBe(true);
    const input = openOrFind.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input['issueCategoryExternalId']).toBe('cancel');
    expect(input['description']).toBe('Shipment has been returned by merchant\n\ncustomer called');
    expect(input['orderId']).toBe('o1');
  });

  it('two concurrent requests open exactly one ticket', async () => {
    const { svc, tickets, openOrFind } = make({});
    const [a, b] = await Promise.all([
      svc.raise(SELLER, 'o1', null),
      svc.raise(SELLER, 'o1', null),
    ]);
    expect(tickets).toHaveLength(1);
    expect(openOrFind).toHaveBeenCalledTimes(1);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(a.ticket.id).toBe(b.ticket.id);
  });

  it('allows a new request once the earlier ticket is closed', async () => {
    const { svc, tickets } = make({});
    await svc.raise(SELLER, 'o1', null);
    tickets[0]!.status = TicketStatus.RESOLVED_RETURNED;
    const again = await svc.raise(SELLER, 'o1', null);
    expect(again.created).toBe(true);
    expect(tickets).toHaveLength(2);
  });

  it('another seller’s order is a 404 and nothing is written', async () => {
    const { svc, openOrFind } = make({ orderFound: false });
    await expect(svc.raise(SELLER, 'o1', null)).rejects.toMatchObject({
      response: { code: 'ORDER_NOT_FOUND' },
    });
    expect(openOrFind).not.toHaveBeenCalled();
  });

  it('refuses an order outside the window with a 409', async () => {
    const { svc, openOrFind } = make({ status: OrderStatus.DELIVERED });
    await expect(svc.raise(SELLER, 'o1', null)).rejects.toMatchObject({
      response: { code: 'CANCEL_REQUEST_NOT_AVAILABLE' },
    });
    expect(openOrFind).not.toHaveBeenCalled();
  });

  it('a member store whose cancel policy is OFF is refused by name', async () => {
    const { svc, openOrFind } = make({ cancelPolicy: ResellerStoreActionMode.OFF });
    await expect(svc.raise(STORE, 'o1', null)).rejects.toMatchObject({
      response: { code: 'STORE_ACTION_NOT_ALLOWED' },
    });
    expect(openOrFind).not.toHaveBeenCalled();
  });

  it('a store on ASK_SELLER still raises it (the ticket goes to Skydrop)', async () => {
    const { svc } = make({ cancelPolicy: ResellerStoreActionMode.ASK_SELLER });
    const res = await svc.raise(STORE, 'o1', null);
    expect(res.created).toBe(true);
  });
});
