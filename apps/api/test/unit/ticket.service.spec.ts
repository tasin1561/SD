import { ActorType, Prisma, TicketStatus, TicketType, WalletEntryDirection } from '@skydrop/db';
import { TicketService } from '../../src/modules/ticket/services/ticket.service';
import { TicketStateMachineService } from '../../src/modules/ticket/services/ticket-state-machine.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';
import type { TicketNotifier } from '../../src/modules/ticket/services/ticket-notifier.service';

type AnyArgs = Record<string, unknown>;

const SELLER = 'seller-1';
const STAFF = 'staff-1';
const TICKET = 'ticket-1';

function ticketRow(over: Partial<AnyArgs> = {}): AnyArgs {
  return {
    id: TICKET,
    ticketNumber: 'TK-2026-000001',
    openedByStaffId: null,
    openedBySellerUserId: null,
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
    // Present and null by default, as Prisma returns them — a fake that
    // omits a column is a fake that never sees an undefined.
    issueCategoryExternalId: null,
    issueSubcategoryExternalId: null,
    ...over,
  };
}

function makeService(
  opts: {
    existing?: AnyArgs | null;
    existingByItem?: AnyArgs | null;
    /** The RECEIPT_SHORTFALL already open for a goods receipt (TKT-3). */
    existingByReceipt?: AnyArgs | null;
    /** Simulate another request winning the guarded claim first — the
     *  guarded updateMany then matches 0 rows. */
    claimLoses?: boolean;
  } = {},
) {
  const findUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async (args) => {
    // open() looks up by the composite (shipmentItemId, ticketType)
    if ((args.where as AnyArgs)['shipmentItemId_ticketType'] !== undefined) {
      return opts.existingByItem === undefined ? null : opts.existingByItem;
    }
    if ((args.where as AnyArgs)['goodsReceiptId_ticketType'] !== undefined) {
      return opts.existingByReceipt === undefined ? null : opts.existingByReceipt;
    }
    return opts.existing === undefined ? ticketRow() : opts.existing;
  });
  const findFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.existing === undefined ? ticketRow() : opts.existing,
  );
  const create = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (a) => ticketRow(a.data as AnyArgs));
  const update = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (a) =>
    ticketRow({ ...(a.data as AnyArgs) }),
  );
  const findMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async () => [ticketRow()]);
  const count = jest.fn(async () => 1);
  // The guarded claim. `count: 0` is how Postgres reports "the row is no
  // longer in the status you validated against" — the second concurrent
  // resolver.
  const updateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(async () => ({
    count: opts.claimLoses ? 0 : 1,
  }));
  const eventCreate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({ id: 'ev-1' }));
  // The courier's own vocabulary, resolved on read. Keyed on externalId,
  // so a view carrying an id gets the word for it.
  const issueCategoryFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async () => [
    { externalId: 'CAT-1', label: 'Delivery delay' },
    { externalId: 'SUB-1', label: 'Not attempted' },
  ]);
  const eventFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async () => []);

  // The ticket-number allocation runs raw SQL on the transaction it is
  // handed: an advisory lock, a lazy CREATE SEQUENCE, then nextval.
  let serial = 0;
  const executeRawUnsafe = jest.fn(async () => 0);
  const queryRawUnsafe = jest.fn(async () => {
    serial += 1;
    return [{ value: BigInt(serial) }];
  });
  const tx = {
    ticket: { findUnique, findFirst, create, update, updateMany },
    ticketEvent: { create: eventCreate },
    $executeRawUnsafe: executeRawUnsafe,
    $queryRawUnsafe: queryRawUnsafe,
  };
  const $transaction = jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
  const client = {
    ticket: { findUnique, findFirst, create, update, updateMany, findMany, count },
    ticketEvent: { create: eventCreate, findMany: eventFindMany },
    courierIssueCategory: { findMany: issueCategoryFindMany },
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

  // TKT-3: every written event is handed to the notifier.
  const afterEvent = jest.fn<void, [string]>();
  const svc = new TicketService(
    prisma,
    audit as unknown as AuditLogService,
    wallet as unknown as WalletService,
    new TicketStateMachineService(),
    { afterEvent } as unknown as TicketNotifier,
  );
  return {
    svc,
    afterEvent,
    create,
    update,
    eventCreate,
    applyEntry,
    recomputeCacheAfterCommit,
    auditLog,
    findMany,
    issueCategoryFindMany,
    claim: updateMany,
    tx,
    $transaction,
    nextval: queryRawUnsafe,
  };
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

describe('TicketService — receipt shortfall + telling the other side (TKT-3)', () => {
  it('a RECEIPT_SHORTFALL is keyed on its goods receipt: a second open finds the first', async () => {
    const existing = ticketRow({
      ticketType: TicketType.RECEIPT_SHORTFALL,
      goodsReceiptId: 'gr-1',
    });
    const { svc, create, afterEvent, nextval } = makeService({ existingByReceipt: existing });
    const r = await svc.openOrFind(
      {
        ticketType: TicketType.RECEIPT_SHORTFALL,
        sellerId: SELLER,
        subject: 'CN-2026-08-000003: 2 short at DAC-01',
        goodsReceiptId: 'gr-1',
      },
      { type: ActorType.SYSTEM },
    );
    expect(r.created).toBe(false);
    expect(create).not.toHaveBeenCalled();
    // Nothing new happened, so nobody is told anything and no number burns.
    expect(afterEvent).not.toHaveBeenCalled();
    expect(nextval).not.toHaveBeenCalled();
  });

  it('a fresh shortfall ticket records the receipt and hands its opening event over', async () => {
    const { svc, create, afterEvent } = makeService();
    const r = await svc.openOrFind(
      {
        ticketType: TicketType.RECEIPT_SHORTFALL,
        sellerId: SELLER,
        subject: 'short',
        goodsReceiptId: 'gr-1',
      },
      { type: ActorType.SYSTEM },
    );
    expect(r.created).toBe(true);
    expect((create.mock.calls[0]?.[0]?.data as AnyArgs).goodsReceiptId).toBe('gr-1');
    expect(afterEvent).toHaveBeenCalledWith('ev-1');
  });

  it('a note and a transition each hand their event over', async () => {
    const note = makeService();
    await note.svc.addNote(TICKET, 'We found two more in a second carton.', {
      type: ActorType.STAFF,
      staffId: STAFF,
    });
    expect(note.afterEvent).toHaveBeenCalledWith('ev-1');

    const move = makeService();
    await move.svc.transition(
      TICKET,
      { to: TicketStatus.RESOLVED_REFUND, refundAmountInr: '640' },
      { type: ActorType.STAFF, staffId: STAFF },
    );
    expect(move.afterEvent).toHaveBeenCalledWith('ev-1');
  });

  it('a transition that loses the claim tells nobody', async () => {
    const { svc, afterEvent } = makeService({ claimLoses: true });
    await expect(
      svc.transition(
        TICKET,
        { to: TicketStatus.RESOLVED_REFUND, refundAmountInr: '640' },
        { type: ActorType.STAFF, staffId: STAFF },
      ),
    ).rejects.toThrow();
    expect(afterEvent).not.toHaveBeenCalled();
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
      svc.transition(
        'nope',
        { to: TicketStatus.NEGOTIATING },
        { type: ActorType.STAFF, staffId: STAFF },
      ),
    ).rejects.toMatchObject({ response: { code: 'TICKET_NOT_FOUND' } });
  });

  it('OPEN → NEGOTIATING writes the status + an event, moves NO money', async () => {
    const { svc, claim, eventCreate, applyEntry } = makeService();
    await svc.transition(
      TICKET,
      { to: TicketStatus.NEGOTIATING, notes: 'asked courier for POD' },
      { type: ActorType.STAFF, staffId: STAFF },
    );
    expect(applyEntry).not.toHaveBeenCalled();
    // The status transition rides on the guarded claim, which is what
    // makes it safe against a concurrent second resolver.
    const claimArgs = claim.mock.calls[0]![0]!;
    expect((claimArgs.where as AnyArgs).status).toBe(TicketStatus.OPEN);
    const data = claimArgs.data as AnyArgs;
    expect(data.status).toBe(TicketStatus.NEGOTIATING);
    // Non-terminal → not stamped resolved.
    expect('resolvedAt' in data).toBe(false);
    const ev = eventCreate.mock.calls[0]![0]!.data as AnyArgs;
    expect(ev).toMatchObject({ fromStatus: TicketStatus.OPEN, toStatus: TicketStatus.NEGOTIATING });
  });

  it('RESOLVED_REFUND credits the seller with SCRAP_REFUND and links the entry', async () => {
    const { svc, update, claim, applyEntry, recomputeCacheAfterCommit } = makeService();
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
    expect((claim.mock.calls[0]![0]!.data as AnyArgs).resolvedAt).toBeInstanceOf(Date);
    expect(recomputeCacheAfterCommit).toHaveBeenCalled();
  });

  it('RESOLVED_REFUND without an amount is rejected before any write', async () => {
    const { svc, update, applyEntry } = makeService();
    await expect(
      svc.transition(
        TICKET,
        { to: TicketStatus.RESOLVED_REFUND },
        { type: ActorType.STAFF, staffId: STAFF },
      ),
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
    const { svc, claim, applyEntry } = makeService();
    await svc.transition(
      TICKET,
      { to: TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED },
      { type: ActorType.STAFF, staffId: STAFF },
    );
    expect(applyEntry).not.toHaveBeenCalled();
    expect((claim.mock.calls[0]![0]!.data as AnyArgs).resolvedAt).toBeInstanceOf(Date);
  });

  /**
   * The check was a read OUTSIDE the transaction and the write was
   * unconditional, so two concurrent RESOLVED_REFUND requests — a
   * double-clicked admin refund button is enough — both passed the
   * state-machine check and both credited the wallet. The seller was paid
   * twice and the ticket recorded only ONE entry id, so the duplicate was
   * invisible in the ticket itself.
   */
  it('a concurrent second resolver is refused BEFORE any money moves', async () => {
    const { svc, applyEntry, update, eventCreate } = makeService({ claimLoses: true });

    await expect(
      svc.transition(
        TICKET,
        { to: TicketStatus.RESOLVED_REFUND, refundAmountInr: '250.50' },
        { type: ActorType.STAFF, staffId: STAFF },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TICKET_ALREADY_MOVED' }),
    });

    // The claim is taken BEFORE the credit precisely so that losing it
    // costs nothing: no wallet entry, no follow-up write, no event.
    expect(applyEntry).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(eventCreate).not.toHaveBeenCalled();
  });
});

describe('TicketService seller scoping', () => {
  it('listForSeller filters by sellerId', async () => {
    const { svc, findMany } = makeService();
    await svc.listForSeller(SELLER);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { sellerId: SELLER } }));
  });

  it("getForSeller 404s rather than leaking another seller's ticket", async () => {
    const { svc } = makeService({ existing: null });
    await expect(svc.getForSeller(SELLER, TICKET)).rejects.toMatchObject({
      response: { code: 'TICKET_NOT_FOUND' },
    });
  });
});

/**
 * TKT-2 — "we passed this to the courier", as its own append-only row.
 *
 * What these pin is the shape, not the plumbing: only the SELLER's words
 * can be relayed, a second call is a no-op rather than a second claim,
 * and the losing side of a race converges on the row that won. The last
 * of those is the one a mocked Prisma can only approximate — there is no
 * index here to violate, so the P2002 is injected; the real guard is the
 * UNIQUE in the migration.
 */
describe('TicketService.markRelayed', () => {
  const EVENT = 'ev-9';

  function makeRelayService(
    opts: {
      event?: AnyArgs | null;
      /** A relay already recorded when we go to insert (the race). */
      raceP2002?: boolean;
    } = {},
  ) {
    const event =
      opts.event === undefined
        ? { id: EVENT, actorType: ActorType.SELLER, relay: null }
        : opts.event;
    const eventFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () => event);
    const relayCreate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => {
      if (opts.raceP2002 === true) {
        throw new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        });
      }
      return { relayedAt: new Date('2026-09-06T10:00:00Z') };
    });
    const relayFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () => ({
      relayedAt: new Date('2026-09-06T09:00:00Z'),
    }));
    const auditLog = jest.fn<Promise<string | null>, [AnyArgs, unknown?]>(async () => 'a1');
    const prisma = {
      client: {
        ticketEvent: { findFirst: eventFindFirst },
        ticketMessageRelay: { create: relayCreate, findUnique: relayFindUnique },
      },
    } as unknown as PrismaService;
    const svc = new TicketService(
      prisma,
      { log: auditLog } as unknown as AuditLogService,
      {} as unknown as WalletService,
      new TicketStateMachineService(),
      { afterEvent: jest.fn() } as unknown as TicketNotifier,
    );
    return { svc, relayCreate, relayFindUnique, auditLog };
  }

  it('records the relay and audits it', async () => {
    const { svc, relayCreate, auditLog } = makeRelayService();
    const res = await svc.markRelayed(TICKET, EVENT, STAFF);
    expect(res.alreadyRelayed).toBe(false);
    expect(relayCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { ticketEventId: EVENT, relayedByStaffId: STAFF },
      }),
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ticket.message_relayed' }),
    );
  });

  it('is a no-op on a message already relayed — not a second row, not a 409', async () => {
    const relayedAt = new Date('2026-09-05T08:00:00Z');
    const { svc, relayCreate } = makeRelayService({
      event: { id: EVENT, actorType: ActorType.SELLER, relay: { relayedAt } },
    });
    const res = await svc.markRelayed(TICKET, EVENT, STAFF);
    expect(res).toEqual({ ticketEventId: EVENT, relayedAt, alreadyRelayed: true });
    expect(relayCreate).not.toHaveBeenCalled();
  });

  it('converges when another operator wins the insert', async () => {
    const { svc, relayFindUnique } = makeRelayService({ raceP2002: true });
    const res = await svc.markRelayed(TICKET, EVENT, STAFF);
    expect(res.alreadyRelayed).toBe(true);
    expect(relayFindUnique).toHaveBeenCalled();
  });

  it('refuses to relay our own message — it never had anywhere else to go', async () => {
    const { svc } = makeRelayService({
      event: { id: EVENT, actorType: ActorType.STAFF, relay: null },
    });
    await expect(svc.markRelayed(TICKET, EVENT, STAFF)).rejects.toMatchObject({
      response: { code: 'NOT_A_SELLER_MESSAGE' },
    });
  });

  it('404s a message that is not on this ticket', async () => {
    const { svc } = makeRelayService({ event: null });
    await expect(svc.markRelayed(TICKET, EVENT, STAFF)).rejects.toMatchObject({
      response: { code: 'TICKET_EVENT_NOT_FOUND' },
    });
  });
});

/**
 * The category the seller picked, in the courier's own words.
 *
 * Resolved on READ rather than stored: the taxonomy is re-fetched from
 * the courier and its rows replaced, so a label copied at create time
 * would slowly stop matching what they call it. What is pinned here is
 * that the resolution happens ONCE for a page, and that a ticket with
 * no category asks for nothing at all.
 */
describe('TicketService issue-category labels', () => {
  it('resolves category + subcategory into the courier’s words', async () => {
    const { svc, findMany, issueCategoryFindMany } = makeService();
    findMany.mockResolvedValueOnce([
      ticketRow({ issueCategoryExternalId: 'CAT-1', issueSubcategoryExternalId: 'SUB-1' }),
    ]);
    const [view] = await svc.listForSeller(SELLER);
    expect(view?.issueCategoryLabel).toBe('Delivery delay');
    expect(view?.issueSubcategoryLabel).toBe('Not attempted');
    expect(issueCategoryFindMany).toHaveBeenCalledTimes(1);
  });

  it('asks for nothing when no ticket on the page carries a category', async () => {
    const { svc, issueCategoryFindMany } = makeService();
    const [view] = await svc.listForSeller(SELLER);
    expect(view?.issueCategoryLabel).toBeNull();
    expect(issueCategoryFindMany).not.toHaveBeenCalled();
  });

  it('resolves a whole page in ONE query, not one per row', async () => {
    const { svc, findMany, issueCategoryFindMany } = makeService();
    findMany.mockResolvedValueOnce([
      ticketRow({ id: 't1', issueCategoryExternalId: 'CAT-1' }),
      ticketRow({ id: 't2', issueCategoryExternalId: 'CAT-1' }),
      ticketRow({ id: 't3', issueCategoryExternalId: 'SUB-1' }),
    ]);
    const views = await svc.listForSeller(SELLER);
    expect(views).toHaveLength(3);
    expect(issueCategoryFindMany).toHaveBeenCalledTimes(1);
    // Deduped — 'CAT-1' twice is one id to look up.
    expect(issueCategoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { externalId: { in: ['CAT-1', 'SUB-1'] } } }),
    );
  });

  it('leaves the label null for a category the courier has since retired', async () => {
    const { svc, findMany } = makeService();
    findMany.mockResolvedValueOnce([ticketRow({ issueCategoryExternalId: 'GONE-9' })]);
    const [view] = await svc.listForSeller(SELLER);
    // The id survives — nothing is lost; there is just no current word.
    expect(view?.issueCategoryExternalId).toBe('GONE-9');
    expect(view?.issueCategoryLabel).toBeNull();
  });
});

describe('TicketService — ticket numbers', () => {
  it('allocates the number on the transaction it is handed, and the description can name it', async () => {
    const { svc, create, tx, $transaction, nextval } = makeService();
    const r = await svc.openOrFind(
      {
        ticketType: TicketType.SCRAP_DAMAGE,
        sellerId: SELLER,
        subject: 'RTO DAMAGED: Widget',
        shipmentItemId: 'si-9',
        descriptionFor: (n) => `Ticket ${n} — our message`,
      },
      { type: ActorType.STAFF, staffId: STAFF },
      tx as never,
    );
    const year = new Date().getUTCFullYear();
    const data = create.mock.calls[0]?.[0]?.data as AnyArgs;
    expect(data.ticketNumber).toBe(`TK-${year}-000001`);
    expect(data.description).toBe(`Ticket TK-${year}-000001 — our message`);
    expect(nextval).toHaveBeenCalledTimes(1);
    // The caller's transaction, not one of our own.
    expect($transaction).not.toHaveBeenCalled();
    expect(r.created).toBe(true);
    expect(r.ticket.ticketNumber).toBe(`TK-${year}-000001`);
    expect(r.ticket.openedBy).toBe('STAFF');
  });

  it('opens in a transaction of its own when none is given, so the number and the row commit together', async () => {
    const { svc, $transaction } = makeService();
    await svc.open(
      { ticketType: TicketType.SELLER_RAISED_ISSUE, sellerId: SELLER, subject: 'Broken' },
      { type: ActorType.SELLER, sellerUserId: 'su-1' },
    );
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it('a retried open of the same auto-raised ticket keeps its number and allocates nothing', async () => {
    const { svc, create, nextval } = makeService({
      existingByItem: ticketRow({ ticketNumber: 'TK-2026-000007' }),
    });
    const r = await svc.openOrFind(
      {
        ticketType: TicketType.SCRAP_DAMAGE,
        sellerId: SELLER,
        subject: 're-inspected',
        shipmentItemId: 'si-1',
      },
      { type: ActorType.STAFF, staffId: STAFF },
    );
    expect(r.created).toBe(false);
    expect(r.ticket.ticketNumber).toBe('TK-2026-000007');
    expect(create).not.toHaveBeenCalled();
    expect(nextval).not.toHaveBeenCalled();
  });
});

describe('TicketService — who opened it', () => {
  it.each([
    ['the opening event says SELLER', { events: [{ actorType: ActorType.SELLER }] }, 'SELLER'],
    ['a seller acting through the API', { events: [{ actorType: ActorType.API }] }, 'SELLER'],
    ['the opening event says STAFF', { events: [{ actorType: ActorType.STAFF }] }, 'STAFF'],
    ['the opening event says SYSTEM', { events: [{ actorType: ActorType.SYSTEM }] }, 'SYSTEM'],
    ['no event read, a staff opener', { openedByStaffId: STAFF }, 'STAFF'],
    ['no event read, a seller opener', { openedBySellerUserId: 'su-1' }, 'SELLER'],
    ['no event read, nobody recorded', {}, 'SYSTEM'],
  ])('%s', async (_label, over, expected) => {
    const { svc } = makeService({ existing: ticketRow(over) });
    const view = await svc.getById(TICKET);
    expect(view.openedBy).toBe(expected);
    expect(view.ticketNumber).toBe('TK-2026-000001');
  });
});

describe('TicketService — search', () => {
  it('the admin list searches the ticket number, subject, order, parcel and waybill', async () => {
    const { svc, findMany } = makeService();
    await svc.listForAdmin({ search: '  tk-2026-000003 ' });
    const where = (findMany.mock.calls[0]?.[0] as AnyArgs).where as AnyArgs;
    const c = { contains: 'tk-2026-000003', mode: 'insensitive' };
    expect(where.OR).toEqual([
      { ticketNumber: c },
      { subject: c },
      { order: { orderNumber: c } },
      { shipment: { shipmentNumber: c } },
      { shipment: { awbNumber: c } },
      // TKT-3: a shortfall ticket is found by its receipt or consignment.
      { goodsReceipt: { receiptNumber: c } },
      { goodsReceipt: { consignment: { consignmentNumber: c } } },
    ]);
  });

  it("the seller list searches too, still scoped to the seller's own tickets", async () => {
    const { svc, findMany } = makeService();
    await svc.listForSeller(SELLER, undefined, undefined, undefined, 'TK-2026');
    const where = (findMany.mock.calls[0]?.[0] as AnyArgs).where as AnyArgs;
    expect(where.sellerId).toBe(SELLER);
    expect(where.OR).toBeDefined();
  });

  it('a blank search adds no filter', async () => {
    const { svc, findMany } = makeService();
    await svc.listForSeller(SELLER, undefined, undefined, undefined, '   ');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { sellerId: SELLER } }));
  });
});

describe('TicketService.addNote on a caller transaction', () => {
  it('writes the note through the transaction it is handed', async () => {
    const { svc, tx, eventCreate } = makeService();
    await svc.addNote(
      TICKET,
      'We looked again.',
      { type: ActorType.STAFF, staffId: STAFF },
      undefined,
      tx as never,
    );
    expect(tx.ticket.findFirst).toHaveBeenCalledTimes(1);
    expect(eventCreate).toHaveBeenCalledTimes(1);
  });
});
