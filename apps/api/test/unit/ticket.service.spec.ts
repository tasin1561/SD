import { ActorType, Prisma, TicketStatus, TicketType, WalletEntryDirection } from '@skydrop/db';
import { TicketService } from '../../src/modules/ticket/services/ticket.service';
import { TicketStateMachineService } from '../../src/modules/ticket/services/ticket-state-machine.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';

type AnyArgs = Record<string, unknown>;

const SELLER = 'seller-1';
const STAFF = 'staff-1';
const TICKET = 'ticket-1';

function ticketRow(over: Partial<AnyArgs> = {}): AnyArgs {
  return {
    id: TICKET,
    ticketType: TicketType.SCRAP_DAMAGE,
    status: TicketStatus.OPEN,
    sellerId: SELLER,
    orderId: 'order-1',
    shipmentId: 'ship-1',
    shipmentItemId: 'si-1',
    courierCode: 'delhivery',
    subject: 'RTO DAMAGED: Widget',
    description: null,
    resolutionAmountInr: null,
    resolutionWalletEntryId: null,
    resolutionNotes: null,
    resolvedAt: null,
    createdAt: new Date(),
    ...over,
  };
}

function makeService(opts: { existing?: AnyArgs | null; existingByItem?: AnyArgs | null } = {}) {
  const findUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async (args) => {
    // open() looks up by the composite (shipmentItemId, ticketType)
    if ((args.where as AnyArgs)['shipmentItemId_ticketType'] !== undefined) {
      return opts.existingByItem === undefined ? null : opts.existingByItem;
    }
    return opts.existing === undefined ? ticketRow() : opts.existing;
  });
  const findFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(
    async () => (opts.existing === undefined ? ticketRow() : opts.existing),
  );
  const create = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (a) =>
    ticketRow(a.data as AnyArgs),
  );
  const update = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (a) =>
    ticketRow({ ...(a.data as AnyArgs) }),
  );
  const findMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async () => [ticketRow()]);
  const count = jest.fn(async () => 1);
  const eventCreate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({ id: 'ev-1' }));
  const eventFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async () => []);

  const tx = {
    ticket: { findUnique, create, update },
    ticketEvent: { create: eventCreate },
  };
  const $transaction = jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
  const client = {
    ticket: { findUnique, findFirst, create, update, findMany, count },
    ticketEvent: { create: eventCreate, findMany: eventFindMany },
    $transaction,
  };
  const prisma = { client } as unknown as PrismaService;

  const auditLog = jest.fn<Promise<string | null>, [AnyArgs, unknown?]>(async () => 'a1');
  const audit = { log: auditLog };

  const applyEntry = jest.fn<Promise<AnyArgs>, [unknown, AnyArgs]>(async () => ({
    id: 'wallet-entry-1',
    runningBalanceAfter: new Prisma.Decimal(0),
  }));
  const recomputeCacheAfterCommit = jest.fn(async () => undefined);
  const wallet = { applyEntry, recomputeCacheAfterCommit };

  const svc = new TicketService(
    prisma,
    audit as unknown as AuditLogService,
    wallet as unknown as WalletService,
    new TicketStateMachineService(),
  );
  return { svc, create, update, eventCreate, applyEntry, recomputeCacheAfterCommit, auditLog, findMany };
}

describe('TicketStateMachineService', () => {
  const sm = new TicketStateMachineService();

  it('OPEN may go to NEGOTIATING or any terminal', () => {
    expect(sm.canTransition(TicketStatus.OPEN, TicketStatus.NEGOTIATING)).toBe(true);
    expect(sm.canTransition(TicketStatus.OPEN, TicketStatus.RESOLVED_REFUND)).toBe(true);
    expect(sm.canTransition(TicketStatus.OPEN, TicketStatus.REJECTED)).toBe(true);
  });

  it('NEGOTIATING may return to OPEN', () => {
    expect(sm.canTransition(TicketStatus.NEGOTIATING, TicketStatus.OPEN)).toBe(true);
  });

  it.each([
    TicketStatus.RESOLVED_REFUND,
    TicketStatus.RESOLVED_RETURNED,
    TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED,
    TicketStatus.REJECTED,
  ])('%s is terminal — no outbound edges', (terminal) => {
    expect(sm.isTerminal(terminal)).toBe(true);
    expect(sm.allowedFrom(terminal)).toHaveLength(0);
    expect(sm.canTransition(terminal, TicketStatus.OPEN)).toBe(false);
  });

  it('OPEN → OPEN is not a legal self-loop', () => {
    expect(sm.canTransition(TicketStatus.OPEN, TicketStatus.OPEN)).toBe(false);
  });
});

describe('TicketService.open', () => {
  it('creates the ticket + an initial OPEN event + audits', async () => {
    const { svc, create, eventCreate, auditLog } = makeService();
    const r = await svc.open(
      {
        ticketType: TicketType.SELLER_RAISED_ISSUE,
        sellerId: SELLER,
        subject: 'Parcel arrived broken',
      },
      { type: ActorType.SELLER, sellerUserId: 'su-1' },
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(TicketStatus.OPEN);
    const ev = eventCreate.mock.calls[0]![0]!.data as AnyArgs;
    expect(ev).toMatchObject({ fromStatus: null, toStatus: TicketStatus.OPEN });
    expect(auditLog.mock.calls[0]![0]!.action).toBe('ticket.opened');
  });

  it('is idempotent for an auto-raised scrap ticket on the same shipment item', async () => {
    const { svc, create } = makeService({ existingByItem: ticketRow() });
    const r = await svc.open(
      {
        ticketType: TicketType.SCRAP_DAMAGE,
        sellerId: SELLER,
        subject: 're-inspected',
        shipmentItemId: 'si-1',
      },
      { type: ActorType.STAFF, staffId: STAFF },
    );
    expect(create).not.toHaveBeenCalled();
    expect(r.id).toBe(TICKET);
  });
});

describe('TicketService.transition', () => {
  it('rejects an illegal transition (terminal → OPEN) without writing', async () => {
    const { svc, update } = makeService({
      existing: ticketRow({ status: TicketStatus.RESOLVED_REFUND }),
    });
    await expect(
      svc.transition(TICKET, { to: TicketStatus.OPEN }, { type: ActorType.STAFF, staffId: STAFF }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_TICKET_TRANSITION' } });
    expect(update).not.toHaveBeenCalled();
  });

  it('404 for an unknown ticket', async () => {
    const { svc } = makeService({ existing: null });
    await expect(
      svc.transition('nope', { to: TicketStatus.NEGOTIATING }, { type: ActorType.STAFF, staffId: STAFF }),
    ).rejects.toMatchObject({ response: { code: 'TICKET_NOT_FOUND' } });
  });

  it('OPEN → NEGOTIATING writes the status + an event, moves NO money', async () => {
    const { svc, update, eventCreate, applyEntry } = makeService();
    await svc.transition(
      TICKET,
      { to: TicketStatus.NEGOTIATING, notes: 'asked courier for POD' },
      { type: ActorType.STAFF, staffId: STAFF },
    );
    expect(applyEntry).not.toHaveBeenCalled();
    const data = update.mock.calls[0]![0]!.data as AnyArgs;
    expect(data.status).toBe(TicketStatus.NEGOTIATING);
    // Non-terminal → not stamped resolved.
    expect('resolvedAt' in data).toBe(false);
    const ev = eventCreate.mock.calls[0]![0]!.data as AnyArgs;
    expect(ev).toMatchObject({ fromStatus: TicketStatus.OPEN, toStatus: TicketStatus.NEGOTIATING });
  });

  it('RESOLVED_REFUND credits the seller with SCRAP_REFUND and links the entry', async () => {
    const { svc, update, applyEntry, recomputeCacheAfterCommit } = makeService();
    await svc.transition(
      TICKET,
      { to: TicketStatus.RESOLVED_REFUND, refundAmountInr: '250.50', notes: 'courier accepted' },
      { type: ActorType.STAFF, staffId: STAFF },
    );
    expect(applyEntry).toHaveBeenCalledTimes(1);
    const entry = applyEntry.mock.calls[0]![1] as AnyArgs;
    expect(entry).toMatchObject({
      sellerId: SELLER,
      direction: WalletEntryDirection.SCRAP_REFUND,
      linkedOrderId: 'order-1',
    });
    expect((entry.amount as Prisma.Decimal).toString()).toBe('250.5');
    const data = update.mock.calls[0]![0]!.data as AnyArgs;
    expect(data.resolutionWalletEntryId).toBe('wallet-entry-1');
    expect(data.resolvedAt).toBeInstanceOf(Date);
    expect(recomputeCacheAfterCommit).toHaveBeenCalled();
  });

  it('RESOLVED_REFUND without an amount is rejected before any write', async () => {
    const { svc, update, applyEntry } = makeService();
    await expect(
      svc.transition(TICKET, { to: TicketStatus.RESOLVED_REFUND }, { type: ActorType.STAFF, staffId: STAFF }),
    ).rejects.toMatchObject({ response: { code: 'REFUND_AMOUNT_REQUIRED' } });
    expect(applyEntry).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('a zero/negative refund amount is rejected', async () => {
    const { svc, applyEntry } = makeService();
    await expect(
      svc.transition(
        TICKET,
        { to: TicketStatus.RESOLVED_REFUND, refundAmountInr: '0' },
        { type: ActorType.STAFF, staffId: STAFF },
      ),
    ).rejects.toMatchObject({ response: { code: 'REFUND_AMOUNT_INVALID' } });
    expect(applyEntry).not.toHaveBeenCalled();
  });

  it('passing an amount with a NON-refund target is rejected (no silent no-op)', async () => {
    const { svc, applyEntry, update } = makeService();
    await expect(
      svc.transition(
        TICKET,
        { to: TicketStatus.RESOLVED_RETURNED, refundAmountInr: '100.00' },
        { type: ActorType.STAFF, staffId: STAFF },
      ),
    ).rejects.toMatchObject({ response: { code: 'REFUND_AMOUNT_NOT_APPLICABLE' } });
    expect(applyEntry).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('RESOLVED_WRITE_OFF_ACCEPTED terminates without moving money', async () => {
    const { svc, update, applyEntry } = makeService();
    await svc.transition(
      TICKET,
      { to: TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED },
      { type: ActorType.STAFF, staffId: STAFF },
    );
    expect(applyEntry).not.toHaveBeenCalled();
    const data = update.mock.calls[0]![0]!.data as AnyArgs;
    expect(data.resolvedAt).toBeInstanceOf(Date);
  });
});

describe('TicketService seller scoping', () => {
  it('listForSeller filters by sellerId', async () => {
    const { svc, findMany } = makeService();
    await svc.listForSeller(SELLER);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sellerId: SELLER } }),
    );
  });

  it('getForSeller 404s rather than leaking another seller\'s ticket', async () => {
    const { svc } = makeService({ existing: null });
    await expect(svc.getForSeller(SELLER, TICKET)).rejects.toMatchObject({
      response: { code: 'TICKET_NOT_FOUND' },
    });
  });
});
