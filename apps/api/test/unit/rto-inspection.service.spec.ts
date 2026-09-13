import { NotFoundException } from '@nestjs/common';
import { ActorType, OrderStatus, RtoDisposition, RtoItemCondition } from '@skydrop/db';
import { RtoInspectionService } from '../../src/modules/warehouse-rto/services/rto-inspection.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { OrderReadService } from '../../src/modules/order/services/order-read.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { TicketService } from '../../src/modules/ticket/services/ticket.service';

type AnyArgs = Record<string, unknown>;

const ITEM = 'si-1';
const SHIP = 'ship-1';
const ORDER = 'order-1';
const STAFF = 'staff-1';

/** A returned line as the inspection reads it — never inspected before. */
const BASE_ITEM = {
  id: ITEM,
  shipmentId: SHIP,
  skuCode: 'AVIATO-GREE-BLAC',
  productName: 'Aviator OG Sunglass',
  quantity: 1,
  rtoCondition: null,
  rtoDisposition: null,
  rtoInspectionNotes: null,
  shipment: {
    id: SHIP,
    courierCode: 'delhivery',
    shipmentNumber: 'SH-TEST-524086',
    awbNumber: '38061110524086',
    rtoReceivedAt: new Date('2026-09-09T18:12:40.920Z'),
    rtoReceivedWarehouseId: null,
    originWarehouseId: 'wh-origin',
    orderShipments: [{ orderId: ORDER }],
  },
  orderItem: { order: { sellerId: 'seller-1' } },
};

function makeService(
  opts: {
    item?: AnyArgs | null;
    orderStatus?: OrderStatus | 'missing';
    /** What openOrFind reports: a fresh ticket, or the existing one. */
    ticketCreated?: boolean;
    /** The ticket findByShipmentItem finds, for a correction to GOOD. */
    existingTicket?: AnyArgs | null;
    /** Serialised units on the line (STRICT mode). */
    serializedUnits?: number;
  } = {},
) {
  const shipmentItemFindUnique = jest.fn(async () =>
    opts.item === undefined ? BASE_ITEM : opts.item,
  );
  const shipmentItemUpdate = jest.fn(async () => ({}));
  const rowsDeleteMany = jest.fn(async () => ({ count: 0 }));
  const rowsCreateMany = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({ count: 1 }));
  const tx = {
    shipmentItem: { update: shipmentItemUpdate },
    shipmentItemRtoInspection: { deleteMany: rowsDeleteMany, createMany: rowsCreateMany },
  };
  const stockUnitCount = jest.fn(async () => opts.serializedUnits ?? 0);
  const $transaction = jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
  const warehouseFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () => ({
    code: 'CCU-01',
    name: 'Kolkata Main',
    timezone: 'Asia/Kolkata',
  }));
  const client = {
    shipmentItem: { findUnique: shipmentItemFindUnique, update: shipmentItemUpdate },
    warehouse: { findUnique: warehouseFindUnique },
    stockUnit: { count: stockUnitCount },
    $transaction,
  };
  const getById = jest.fn(async () =>
    opts.orderStatus === 'missing'
      ? null
      : {
          orderId: ORDER,
          orderNumber: 'SD-TEST-524086',
          status: opts.orderStatus ?? OrderStatus.RTO_RECEIVED,
        },
  );
  const orders = { getById };
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a');
  const audit = { log: auditLog };

  const openOrFind = jest.fn<Promise<AnyArgs>, [AnyArgs, AnyArgs, unknown?]>(async () => ({
    ticket: { id: 'ticket-1', resolvedAt: null },
    created: opts.ticketCreated ?? true,
  }));
  const addNote = jest.fn<Promise<AnyArgs>, [string, string, AnyArgs, unknown, unknown?]>(
    async () => ({ ticketId: 'ticket-1', at: new Date() }),
  );
  const findByShipmentItem = jest.fn<Promise<AnyArgs | null>, [string, unknown, unknown?]>(
    async () => (opts.existingTicket === undefined ? null : opts.existingTicket),
  );
  const tickets = { openOrFind, addNote, findByShipmentItem };

  const svc = new RtoInspectionService(
    { client } as unknown as PrismaService,
    orders as unknown as OrderReadService,
    audit as unknown as AuditLogService,
    tickets as unknown as TicketService,
  );
  return {
    svc,
    tx,
    shipmentItemFindUnique,
    shipmentItemUpdate,
    warehouseFindUnique,
    auditLog,
    openOrFind,
    addNote,
    findByShipmentItem,
    rowsDeleteMany,
    rowsCreateMany,
    stockUnitCount,
  };
}

/** The opening description the inspection handed TicketService, for a number. */
function openingFor(openOrFind: jest.Mock, ticketNumber: string): string {
  const input = openOrFind.mock.calls[0]?.[0] as { descriptionFor?: (n: string) => string };
  if (input.descriptionFor === undefined) throw new Error('no descriptionFor passed');
  return input.descriptionFor(ticketNumber);
}

describe('RtoInspectionService.inspect', () => {
  it('writes the inspection + audits (MEDIUM)', async () => {
    const { svc, shipmentItemUpdate, auditLog } = makeService();
    const r = await svc.inspect(
      ITEM,
      {
        condition: RtoItemCondition.DAMAGED,
        disposition: RtoDisposition.WRITE_OFF,
        notes: 'box crushed',
      },
      STAFF,
    );
    expect(shipmentItemUpdate).toHaveBeenCalledWith({
      where: { id: ITEM },
      data: {
        rtoCondition: RtoItemCondition.DAMAGED,
        rtoDisposition: RtoDisposition.WRITE_OFF,
        rtoDisposedByStaffId: STAFF,
        rtoInspectionNotes: 'box crushed',
      },
    });
    expect(r).toMatchObject({
      shipmentItemId: ITEM,
      shipmentId: SHIP,
      orderId: ORDER,
      rtoCondition: RtoItemCondition.DAMAGED,
      rtoDisposition: RtoDisposition.WRITE_OFF,
      rtoInspectionNotes: 'box crushed',
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'rto.inspected',
        severity: 'MEDIUM',
      }),
    );
  });

  it('null notes when omitted', async () => {
    const { svc, shipmentItemUpdate } = makeService();
    const r = await svc.inspect(
      ITEM,
      { condition: RtoItemCondition.GOOD, disposition: RtoDisposition.RESTOCK },
      STAFF,
    );
    expect(r.rtoInspectionNotes).toBeNull();
    expect(shipmentItemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rtoInspectionNotes: null }),
      }),
    );
  });

  it('re-inspection overwrites prior values (operator correction)', async () => {
    const { svc, shipmentItemUpdate } = makeService({
      item: {
        ...BASE_ITEM,
        rtoCondition: RtoItemCondition.GOOD,
        rtoDisposition: RtoDisposition.RESTOCK,
        rtoInspectionNotes: 'looks fine',
      },
    });
    await svc.inspect(
      ITEM,
      {
        condition: RtoItemCondition.DAMAGED,
        disposition: RtoDisposition.WRITE_OFF,
        notes: 'on closer look, water damage',
      },
      STAFF,
    );
    expect(shipmentItemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rtoCondition: RtoItemCondition.DAMAGED,
          rtoDisposition: RtoDisposition.WRITE_OFF,
        }),
      }),
    );
  });

  it('404 when shipment_item is missing', async () => {
    const { svc } = makeService({ item: null });
    await expect(
      svc.inspect(
        ITEM,
        { condition: RtoItemCondition.GOOD, disposition: RtoDisposition.RESTOCK },
        STAFF,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects ORDER_NOT_INSPECTABLE when order is not RTO_RECEIVED', async () => {
    const { svc } = makeService({ orderStatus: OrderStatus.PACKED });
    await expect(
      svc.inspect(
        ITEM,
        { condition: RtoItemCondition.GOOD, disposition: RtoDisposition.RESTOCK },
        STAFF,
      ),
    ).rejects.toMatchObject({ response: { code: 'ORDER_NOT_INSPECTABLE' } });
  });
  // ── R7: scrap-ticket auto-raise ──────────────────────────────────────

  it('R7: a DAMAGED line auto-raises a SCRAP_DAMAGE ticket inside the inspection tx', async () => {
    const { svc, openOrFind, tx } = makeService();
    await svc.inspect(
      ITEM,
      { condition: RtoItemCondition.DAMAGED, disposition: RtoDisposition.WRITE_OFF },
      STAFF,
    );
    expect(openOrFind).toHaveBeenCalledTimes(1);
    const [input, actor, passedTx] = openOrFind.mock.calls[0] ?? [];
    expect(input).toMatchObject({
      ticketType: 'SCRAP_DAMAGE',
      sellerId: 'seller-1',
      shipmentItemId: ITEM,
      shipmentId: SHIP,
      orderId: ORDER,
      courierCode: 'delhivery',
      rtoCondition: RtoItemCondition.DAMAGED,
    });
    expect(actor).toEqual({ type: ActorType.STAFF, staffId: STAFF });
    // Passed the tx handle => atomic with the inspection write.
    expect(passedTx).toBe(tx);
  });

  it('opens with OUR message stating the facts, even with no inspector notes', async () => {
    const { svc, openOrFind, warehouseFindUnique } = makeService();
    await svc.inspect(
      ITEM,
      { condition: RtoItemCondition.DAMAGED, disposition: RtoDisposition.WRITE_OFF },
      STAFF,
    );
    // No receiving warehouse on the shipment ⇒ received at the origin (R6).
    expect(warehouseFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'wh-origin' } }),
    );
    const msg = openingFor(openOrFind, 'TK-2026-000003');
    expect(msg).toContain('Ticket TK-2026-000003');
    expect(msg).toContain('Aviator OG Sunglass (AVIATO-GREE-BLAC), quantity 1: arrived damaged.');
    expect(msg).toContain('Order SD-TEST-524086 · parcel SH-TEST-524086 · waybill 38061110524086');
    expect(msg).toContain('Received back on 9 Sep 2026 at CCU-01 (Kolkata Main).');
    expect(msg).toContain('writing it off');
    expect(msg).not.toContain("Inspector's note");
  });

  it("quotes the inspector's notes inside our message rather than using them as the message", async () => {
    const { svc, openOrFind } = makeService();
    await svc.inspect(
      ITEM,
      {
        condition: RtoItemCondition.MISSING,
        disposition: RtoDisposition.WRITE_OFF,
        notes: 'box arrived empty',
      },
      STAFF,
    );
    const msg = openingFor(openOrFind, 'TK-2026-000004');
    expect(msg).toContain('was missing from the returned parcel');
    expect(msg).toContain(`Inspector's note: "box arrived empty"`);
    expect((openOrFind.mock.calls[0]?.[0] as AnyArgs).description).toBeUndefined();
  });

  it('R7: a MISSING line also auto-raises', async () => {
    const { svc, openOrFind } = makeService();
    await svc.inspect(
      ITEM,
      { condition: RtoItemCondition.MISSING, disposition: RtoDisposition.WRITE_OFF },
      STAFF,
    );
    expect(openOrFind).toHaveBeenCalledTimes(1);
    expect((openOrFind.mock.calls[0]?.[0] as AnyArgs).rtoCondition).toBe(RtoItemCondition.MISSING);
  });

  it('R7: a GOOD line raises NO ticket and says nothing', async () => {
    const { svc, openOrFind, addNote, findByShipmentItem } = makeService();
    await svc.inspect(
      ITEM,
      { condition: RtoItemCondition.GOOD, disposition: RtoDisposition.RESTOCK },
      STAFF,
    );
    expect(openOrFind).not.toHaveBeenCalled();
    expect(addNote).not.toHaveBeenCalled();
    expect(findByShipmentItem).not.toHaveBeenCalled();
  });

  // ── Re-inspection: a changed finding is SAID on the ticket ──────────

  it('a fresh ticket gets no correction note — its opening message already says it', async () => {
    const { svc, addNote } = makeService({
      item: { ...BASE_ITEM, rtoCondition: RtoItemCondition.GOOD },
      ticketCreated: true,
    });
    await svc.inspect(
      ITEM,
      { condition: RtoItemCondition.DAMAGED, disposition: RtoDisposition.WRITE_OFF },
      STAFF,
    );
    expect(addNote).not.toHaveBeenCalled();
  });

  it('a changed finding on an existing ticket adds our note, in the inspection tx', async () => {
    const { svc, addNote, tx } = makeService({
      item: {
        ...BASE_ITEM,
        rtoCondition: RtoItemCondition.DAMAGED,
        rtoDisposition: RtoDisposition.WRITE_OFF,
        rtoInspectionNotes: null,
      },
      ticketCreated: false,
    });
    await svc.inspect(
      ITEM,
      { condition: RtoItemCondition.MISSING, disposition: RtoDisposition.WRITE_OFF },
      STAFF,
    );
    expect(addNote).toHaveBeenCalledTimes(1);
    const [ticketId, note, actor, scope, passedTx] = addNote.mock.calls[0] ?? [];
    expect(ticketId).toBe('ticket-1');
    expect(note).toContain('We inspected this item again');
    expect(note).toContain('was missing from the returned parcel');
    expect(actor).toEqual({ type: ActorType.STAFF, staffId: STAFF });
    expect(scope).toBeUndefined();
    expect(passedTx).toBe(tx);
  });

  it('an identical re-inspection says nothing new', async () => {
    const { svc, addNote } = makeService({
      item: {
        ...BASE_ITEM,
        rtoCondition: RtoItemCondition.DAMAGED,
        rtoDisposition: RtoDisposition.WRITE_OFF,
        rtoInspectionNotes: null,
      },
      ticketCreated: false,
    });
    await svc.inspect(
      ITEM,
      { condition: RtoItemCondition.DAMAGED, disposition: RtoDisposition.WRITE_OFF },
      STAFF,
    );
    expect(addNote).not.toHaveBeenCalled();
  });

  it('a correction to GOOD tells the seller on the open ticket, and opens nothing', async () => {
    const { svc, openOrFind, addNote, findByShipmentItem } = makeService({
      item: {
        ...BASE_ITEM,
        rtoCondition: RtoItemCondition.DAMAGED,
        rtoDisposition: RtoDisposition.WRITE_OFF,
      },
      existingTicket: { id: 'ticket-1', resolvedAt: null },
    });
    await svc.inspect(
      ITEM,
      { condition: RtoItemCondition.GOOD, disposition: RtoDisposition.RESTOCK },
      STAFF,
    );
    expect(openOrFind).not.toHaveBeenCalled();
    expect(findByShipmentItem).toHaveBeenCalledWith(ITEM, 'SCRAP_DAMAGE', expect.anything());
    expect(addNote.mock.calls[0]?.[1]).toContain('is in good condition after all');
  });

  // ── WMS-8d: a line inspected by quantity ─────────────────────────────

  const QTY2 = { ...BASE_ITEM, quantity: 2 };
  const SPLIT = [
    { quantity: 1, condition: RtoItemCondition.GOOD, disposition: RtoDisposition.RESTOCK },
    {
      quantity: 1,
      condition: RtoItemCondition.DAMAGED,
      disposition: RtoDisposition.HOLD_DAMAGED,
      notes: 'cracked lens',
    },
  ];

  it('an unsplit verdict is ONE row covering the whole line, written after the line lock', async () => {
    const { svc, shipmentItemUpdate, rowsDeleteMany, rowsCreateMany } = makeService({
      item: QTY2,
    });
    const r = await svc.inspect(
      ITEM,
      { condition: RtoItemCondition.GOOD, disposition: RtoDisposition.RESTOCK },
      STAFF,
    );
    expect(rowsCreateMany).toHaveBeenCalledWith({
      data: [
        {
          shipmentItemId: ITEM,
          position: 1,
          quantity: 2,
          condition: RtoItemCondition.GOOD,
          disposition: RtoDisposition.RESTOCK,
          notes: null,
        },
      ],
    });
    // The line update takes the row lock BEFORE the rows are replaced, so
    // two inspectors saving one line serialise instead of interleaving.
    const lockOrd = shipmentItemUpdate.mock.invocationCallOrder[0] ?? 0;
    expect(lockOrd).toBeLessThan(rowsDeleteMany.mock.invocationCallOrder[0] ?? 0);
    expect(r.rows).toHaveLength(1);
  });

  it('a split line writes one row per decision and keeps the summary columns meaningful', async () => {
    const { svc, shipmentItemUpdate, rowsCreateMany } = makeService({ item: QTY2 });
    const r = await svc.inspect(ITEM, { rows: SPLIT }, STAFF);
    const created = (rowsCreateMany.mock.calls[0]?.[0] as { data: AnyArgs[] }).data;
    expect(created).toEqual([
      expect.objectContaining({ position: 1, quantity: 1, disposition: RtoDisposition.RESTOCK }),
      expect.objectContaining({
        position: 2,
        quantity: 1,
        disposition: RtoDisposition.HOLD_DAMAGED,
        notes: 'cracked lens',
      }),
    ]);
    // Summary: worst condition, the restock (a unit goes back to sellable).
    expect(shipmentItemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rtoCondition: RtoItemCondition.DAMAGED,
          rtoDisposition: RtoDisposition.RESTOCK,
        }),
      }),
    );
    expect(r).toMatchObject({
      rtoCondition: RtoItemCondition.DAMAGED,
      rtoDisposition: RtoDisposition.RESTOCK,
    });
  });

  it('a damaged unit on a split line opens ONE ticket saying which units and what happens to each', async () => {
    const { svc, openOrFind } = makeService({ item: QTY2 });
    await svc.inspect(ITEM, { rows: SPLIT }, STAFF);
    expect(openOrFind).toHaveBeenCalledTimes(1);
    expect((openOrFind.mock.calls[0]?.[0] as AnyArgs).rtoCondition).toBe(RtoItemCondition.DAMAGED);
    const msg = openingFor(openOrFind, 'TK-2026-000010');
    expect(msg).toContain('quantity 2 — we checked each unit:');
    expect(msg).toContain(
      '• 1 of 2 is in good condition: we are putting it back into your sellable stock.',
    );
    expect(msg).toContain('• 1 of 2 arrived damaged: we are keeping it aside for you');
    expect(msg).toContain(`Inspector's note: "cracked lens"`);
  });

  it('rows that do not cover the line are refused before anything is written', async () => {
    const { svc, rowsCreateMany, shipmentItemUpdate } = makeService({
      item: { ...BASE_ITEM, quantity: 3 },
    });
    await expect(svc.inspect(ITEM, { rows: SPLIT }, STAFF)).rejects.toMatchObject({
      response: { code: 'RTO_SPLIT_QUANTITY_MISMATCH' },
    });
    expect(rowsCreateMany).not.toHaveBeenCalled();
    expect(shipmentItemUpdate).not.toHaveBeenCalled();
  });

  it('refuses one verdict AND rows together', async () => {
    const { svc } = makeService({ item: QTY2 });
    await expect(
      svc.inspect(
        ITEM,
        { condition: RtoItemCondition.GOOD, disposition: RtoDisposition.RESTOCK, rows: SPLIT },
        STAFF,
      ),
    ).rejects.toMatchObject({ response: { code: 'RTO_INSPECTION_AMBIGUOUS' } });
  });

  it('refuses to split a line that carries serialised units (STRICT)', async () => {
    const { svc, rowsCreateMany } = makeService({ item: QTY2, serializedUnits: 2 });
    await expect(svc.inspect(ITEM, { rows: SPLIT }, STAFF)).rejects.toMatchObject({
      response: { code: 'RTO_SPLIT_SERIALIZED_LINE' },
    });
    expect(rowsCreateMany).not.toHaveBeenCalled();
  });

  it('a serialised line inspected with ONE verdict is not asked about units at all', async () => {
    const { svc, stockUnitCount } = makeService({ item: QTY2, serializedUnits: 2 });
    await svc.inspect(
      ITEM,
      { condition: RtoItemCondition.DAMAGED, disposition: RtoDisposition.HOLD_DAMAGED },
      STAFF,
    );
    expect(stockUnitCount).not.toHaveBeenCalled();
  });

  it('re-inspecting with a DIFFERENT split adds our note to the open ticket', async () => {
    const { svc, addNote } = makeService({
      item: {
        ...QTY2,
        rtoCondition: RtoItemCondition.DAMAGED,
        rtoDisposition: RtoDisposition.WRITE_OFF,
        rtoInspections: [
          {
            quantity: 2,
            condition: RtoItemCondition.DAMAGED,
            disposition: RtoDisposition.WRITE_OFF,
            notes: null,
          },
        ],
      },
      ticketCreated: false,
    });
    await svc.inspect(ITEM, { rows: SPLIT }, STAFF);
    expect(addNote).toHaveBeenCalledTimes(1);
    expect(addNote.mock.calls[0]?.[1]).toContain('We inspected this item again');
    expect(addNote.mock.calls[0]?.[1]).toContain('1 of 2 arrived damaged');
  });

  it('a correction on a CLOSED ticket adds nothing — nobody is coming back to it', async () => {
    const { svc, addNote } = makeService({
      item: {
        ...BASE_ITEM,
        rtoCondition: RtoItemCondition.DAMAGED,
        rtoDisposition: RtoDisposition.WRITE_OFF,
      },
      existingTicket: { id: 'ticket-1', resolvedAt: new Date() },
    });
    await svc.inspect(
      ITEM,
      { condition: RtoItemCondition.GOOD, disposition: RtoDisposition.RESTOCK },
      STAFF,
    );
    expect(addNote).not.toHaveBeenCalled();
  });
});
