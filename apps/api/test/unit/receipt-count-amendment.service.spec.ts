import { ConsignmentEventType, GoodsReceiptStatus, TicketType } from '@skydrop/db';
import { ReceiptCountAmendmentService } from '../../src/modules/inventory-receipt/services/receipt-count-amendment.service';
import { GoodsReceiptService } from '../../src/modules/inventory-receipt/services/goods-receipt.service';

const CTX = { ipAddress: null, userAgent: null, requestId: null };
const REASON = 'Recounted the cartons on the floor';

function makeSut(opts: {
  status?: GoodsReceiptStatus;
  existingTicket?: { id: string; ticketNumber: string } | null;
  ticketThrows?: boolean;
  racedToCompleted?: boolean;
}) {
  const receipt = {
    id: 'gr1',
    sellerId: 's1',
    receiptNumber: 'GR-2026-11-0001',
    consignmentId: 'c1',
    status: opts.status ?? GoodsReceiptStatus.ARRIVING,
    lines: [{ id: 'l1', variantId: 'v1', expectedQty: 10, receivedQty: 0, damagedQty: 0 }],
  };
  const updateMany = jest.fn(async () => ({ count: opts.racedToCompleted ? 0 : 1 }));
  const client = {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(client),
    goodsReceiptLine: { updateMany },
    ticket: { findUnique: jest.fn(async () => opts.existingTicket ?? null) },
  };
  const audit = { log: jest.fn(async () => 'a1') };
  const events = { append: jest.fn(async () => ({ id: 'e1' })) };
  const tickets = {
    addNote: jest.fn(async () => {
      if (opts.ticketThrows) throw new Error('boom');
      return { ticketId: 't1', at: new Date() };
    }),
    openOrFind: jest.fn(async () => {
      if (opts.ticketThrows) throw new Error('boom');
      return { ticket: { id: 't2', ticketNumber: 'TKT-2' }, created: true };
    }),
  };
  const receipts = {
    getForAdmin: jest.fn(async () => receipt),
    assertStatus: GoodsReceiptService.prototype.assertStatus,
  };
  const catalog = {
    getVariantsByIds: jest.fn(async () => new Map([['v1', { skuCode: 'AVIATO-BLAC-GOLD' }]])),
  };
  const svc = new ReceiptCountAmendmentService(
    { client } as never,
    audit as never,
    receipts as never,
    events as never,
    tickets as never,
    catalog as never,
  );
  return { svc, updateMany, audit, events, tickets };
}

describe('ReceiptCountAmendmentService', () => {
  it('amends an ARRIVING line and writes the audit row and the VARIANCE_RECORDED event', async () => {
    const s = makeSut({});
    const out = await s.svc.amend('st1', 'gr1', 'l1', { receivedQty: 8, reason: REASON }, CTX);
    expect(s.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { receivedQty: 8, damagedQty: 0 } }),
    );
    expect(s.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inventory.goods_receipt.count_amended',
        severity: 'HIGH',
        changes: {
          receivedQty: { before: 0, after: 8 },
          damagedQty: { before: 0, after: 0 },
        },
        metadata: expect.objectContaining({ reason: REASON, actorStaffId: 'st1' }),
      }),
      expect.anything(),
    );
    expect(s.events.append).toHaveBeenCalledWith(
      expect.objectContaining({
        consignmentId: 'c1',
        type: ConsignmentEventType.VARIANCE_RECORDED,
      }),
      expect.anything(),
    );
    expect(out.previousReceivedQty).toBe(0);
    expect(out.receivedQty).toBe(8);
  });

  it('refuses a COMPLETED receipt with RECEIPT_COUNT_ALREADY_BANKED and writes nothing', async () => {
    const s = makeSut({ status: GoodsReceiptStatus.COMPLETED });
    await expect(
      s.svc.amend('st1', 'gr1', 'l1', { receivedQty: 8, reason: REASON }, CTX),
    ).rejects.toMatchObject({ response: { code: 'RECEIPT_COUNT_ALREADY_BANKED' } });
    expect(s.updateMany).not.toHaveBeenCalled();
    expect(s.audit.log).not.toHaveBeenCalled();
  });

  it('refuses a receipt that completes between the read and the write', async () => {
    const s = makeSut({ racedToCompleted: true });
    await expect(
      s.svc.amend('st1', 'gr1', 'l1', { receivedQty: 8, reason: REASON }, CTX),
    ).rejects.toMatchObject({ response: { code: 'RECEIPT_COUNT_ALREADY_BANKED' } });
    expect(s.audit.log).not.toHaveBeenCalled();
  });

  it('adds a note to the leg’s existing ticket', async () => {
    const s = makeSut({ existingTicket: { id: 't1', ticketNumber: 'TKT-1' } });
    const out = await s.svc.amend('st1', 'gr1', 'l1', { receivedQty: 8, reason: REASON }, CTX);
    expect(s.tickets.addNote).toHaveBeenCalledWith(
      't1',
      // The FACTS of the change — it is the seller's stock, so they are told.
      expect.stringContaining('received 0 → 8'),
      expect.objectContaining({ staffId: 'st1' }),
    );
    /*
      And NOT the staff reason, nor the staff id. A ticket note has no
      internal mode — `addNote` writes a ticketEvent and the notifier
      relays it — so anything put here reaches the client. The reason is
      a justification written for an auditor ("Riya miscounted, she is
      new"); it lives in `audit_logs` and on the seller-invisible
      consignment event instead. Asserted here because the leak is
      invisible at the call site and would be found by a customer.
    */
    const note = String(s.tickets.addNote.mock.calls[0]?.[1] ?? '');
    expect(note).not.toContain(REASON);
    expect(note).not.toContain('st1');
    expect(s.tickets.openOrFind).not.toHaveBeenCalled();
    expect(out.ticket).toEqual({ id: 't1', ticketNumber: 'TKT-1', created: false });
  });

  it('opens a RECEIPT_SHORTFALL ticket on the leg when none exists', async () => {
    const s = makeSut({});
    const out = await s.svc.amend('st1', 'gr1', 'l1', { receivedQty: 8, reason: REASON }, CTX);
    expect(s.tickets.openOrFind).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketType: TicketType.RECEIPT_SHORTFALL,
        goodsReceiptId: 'gr1',
        sellerId: 's1',
      }),
      expect.anything(),
    );
    expect(out.ticket?.created).toBe(true);
  });

  it('keeps the amendment when the ticket step fails, and audits the failure', async () => {
    const s = makeSut({ ticketThrows: true });
    const out = await s.svc.amend('st1', 'gr1', 'l1', { receivedQty: 8, reason: REASON }, CTX);
    expect(out.ticket).toBeNull();
    expect(out.receivedQty).toBe(8);
    expect(s.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'inventory.goods_receipt.count_amend_ticket_failed' }),
    );
  });

  it('accepts a count above the declared quantity (CNS-3)', async () => {
    const s = makeSut({});
    const out = await s.svc.amend('st1', 'gr1', 'l1', { receivedQty: 15, reason: REASON }, CTX);
    expect(out.receivedQty).toBe(15);
    expect(s.updateMany).toHaveBeenCalled();
  });
});
