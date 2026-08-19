import { TransitArrivalService } from '../../src/modules/inventory-receipt/services/transit-arrival.service';
import type { StockMutationService } from '../../src/modules/inventory-shared/stock-mutation.service';
import type { StockUnitService } from '../../src/modules/inventory-shared/stock-unit.service';

type Any = any;

/**
 * Receiving a leg we dispatched to ourselves.
 *
 * The property under test is CONSERVATION plus honesty about the
 * difference. A normal receipt CREATES stock; an arrival must not, because
 * the goods have been sitting in the destination's TRANSIT bin since
 * dispatch — posting RECEIVING would double them, and the copy would be
 * the sellable one.
 */
function makeSut(inTransit: number) {
  const applied: Any[] = [];
  const mutation = {
    apply: async (_tx: unknown, input: Any) => {
      applied.push(input);
      return { movementId: `mv-${applied.length}` };
    },
  } as unknown as StockMutationService;

  const unitMoves: Any[] = [];
  const units = {
    moveUnitsForReceiptLine: async (_tx: unknown, input: Any) => {
      unitMoves.push(input);
      return input.toStatus === 'LOST'
        ? Array.from({ length: input.limit }, (_, i) => `SDU-LOST-${i}`)
        : [];
    },
  } as unknown as StockUnitService;

  const tx = {
    stockLevel: {
      findUnique: async () => (inTransit === -1 ? null : { qtyOnHand: inTransit }),
    },
  } as unknown as Parameters<TransitArrivalService['writeArrivalLine']>[0];

  return { svc: new TransitArrivalService(mutation, units), applied, unitMoves, tx };
}

const base = {
  sellerId: 's1',
  variantId: 'v1',
  warehouseId: 'w-in',
  goodsReceiptLineId: 'grl-1',
  batchId: 'b-child',
  transitBinId: 'bin-transit',
  putawayBinId: 'bin-shelf',
  staffId: 'staff1',
  receiptNumber: 'CN-2026-08-000001-000123',
  strict: false,
};

describe('TransitArrivalService — an arrival MOVES stock, never creates it', () => {
  it('exact match: one paired transfer out of TRANSIT, no adjustment', async () => {
    const sut = makeSut(10);
    const r = await sut.svc.writeArrivalLine(sut.tx, { ...base, receivedQty: 10 });

    expect(r).toMatchObject({ moved: 10, lost: 0, surplus: 0 });
    expect(sut.applied).toHaveLength(2);
    expect(sut.applied[0]).toMatchObject({
      type: 'TRANSFER_OUT',
      binId: 'bin-transit',
      qtyChange: -10,
    });
    expect(sut.applied[1]).toMatchObject({
      type: 'TRANSFER_IN',
      binId: 'bin-shelf',
      qtyChange: 10,
    });
    // Both legs share one group id, so the pair reads back as one move.
    expect(sut.applied[0].transferGroupId).toBe(sut.applied[1].transferGroupId);
    // No RECEIVING. This is the whole point: the stock already existed.
    expect(sut.applied.some((a) => a.type === 'RECEIVING')).toBe(false);
  });

  it('SHORT: moves what arrived and writes off the rest as IN_TRANSIT_LOSS', async () => {
    const sut = makeSut(10);
    const r = await sut.svc.writeArrivalLine(sut.tx, { ...base, receivedQty: 7 });

    expect(r).toMatchObject({ moved: 7, lost: 3, surplus: 0 });
    const loss = sut.applied.find((a) => a.type === 'ADJUSTMENT_DECREASE');
    expect(loss).toMatchObject({
      qtyChange: -3,
      reasonCode: 'IN_TRANSIT_LOSS',
      // Out of TRANSIT, not off the shelf — those three never reached it.
      binId: 'bin-transit',
    });
    // Conservation: 7 shelved + 3 written off = the 10 that were in transit.
    const net = sut.applied.reduce((n, a) => n + a.qtyChange, 0);
    expect(net).toBe(-10 + 7);
  });

  it('OVER: counts move in both directions, and a surplus is not refused', async () => {
    const sut = makeSut(10);
    const r = await sut.svc.writeArrivalLine(sut.tx, { ...base, receivedQty: 12 });

    expect(r).toMatchObject({ moved: 10, lost: 0, surplus: 2 });
    const gain = sut.applied.find((a) => a.type === 'ADJUSTMENT_INCREASE');
    expect(gain).toMatchObject({
      qtyChange: 2,
      reasonCode: 'IN_TRANSIT_SURPLUS',
      // Onto the shelf: they are physically here and countable.
      binId: 'bin-shelf',
    });
  });

  it('nothing in transit: no movement at all, the whole count is surplus', async () => {
    const sut = makeSut(0);
    const r = await sut.svc.writeArrivalLine(sut.tx, { ...base, receivedQty: 4 });
    expect(r).toMatchObject({ moved: 0, lost: 0, surplus: 4 });
    expect(sut.applied.filter((a) => a.type.startsWith('TRANSFER'))).toHaveLength(0);
  });

  it('a missing stock level reads as zero rather than throwing', async () => {
    const sut = makeSut(-1);
    const r = await sut.svc.writeArrivalLine(sut.tx, { ...base, receivedQty: 3 });
    expect(r.surplus).toBe(3);
  });

  it('STRICT short: the shortfall is a NAMED LIST of serials, not a number', async () => {
    const sut = makeSut(10);
    const r = await sut.svc.writeArrivalLine(sut.tx, { ...base, receivedQty: 7, strict: true });

    // This is the reason to prefer labelling in Bangladesh: the arrival is
    // a scan against the units that left, so "we are three short" becomes
    // three serials that can be chased.
    expect(r.lostSerials).toHaveLength(3);
    const lost = sut.unitMoves.find((m) => m.toStatus === 'LOST');
    expect(lost).toMatchObject({
      limit: 3,
      currentBinId: 'bin-transit',
      writeOffReason: 'IN_TRANSIT_LOSS',
    });
    // The ones that DID arrive move onto the shelf, staying IN_STOCK.
    const shelved = sut.unitMoves.find((m) => m.toStatus === 'IN_STOCK');
    expect(shelved).toMatchObject({ limit: 7, binId: 'bin-shelf' });
  });

  it('NORMAL mode touches no units at all', async () => {
    const sut = makeSut(10);
    await sut.svc.writeArrivalLine(sut.tx, { ...base, receivedQty: 7, strict: false });
    expect(sut.unitMoves).toHaveLength(0);
  });
});
