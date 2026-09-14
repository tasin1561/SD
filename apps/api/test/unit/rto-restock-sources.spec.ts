import {
  resolveRestockSources,
  type LeftStockMovement,
  type RestockLine,
} from '../../src/modules/warehouse-rto/services/rto-restock-sources';

const WH = 'wh-1';

function line(over: Partial<RestockLine> = {}): RestockLine {
  return {
    shipmentItemId: 'si-1',
    orderItemId: 'oi-1',
    variantId: 'v-1',
    quantity: 2,
    pickedBinId: null,
    pickedBatchId: null,
    ...over,
  };
}

function packed(over: Partial<LeftStockMovement> = {}): LeftStockMovement {
  return {
    id: 'm-1',
    warehouseId: WH,
    binId: 'bin-A',
    batchId: 'bat-A',
    qtyChange: -2,
    orderItemId: 'oi-1',
    variantId: 'v-1',
    ...over,
  };
}

function resolve(
  lines: RestockLine[],
  leftMovements: LeftStockMovement[],
  reversed: string[] = [],
): ReturnType<typeof resolveRestockSources> {
  return resolveRestockSources({
    lines,
    leftMovements,
    reversedMovementIds: new Set(reversed),
    originWarehouseId: WH,
  });
}

describe('resolveRestockSources — where a returned unit left from', () => {
  it('no hint, one PACK_CONFIRM source → restocks exactly there', () => {
    const r = resolve([line()], [packed()]);
    expect(r.neverLeft).toEqual([]);
    expect(r.resolved[0]).toEqual({
      shipmentItemId: 'si-1',
      origin: 'PACK_MOVEMENT',
      sources: [{ warehouseId: WH, binId: 'bin-A', batchId: 'bat-A', quantity: 2 }],
      hintDisagrees: false,
    });
  });

  it('a line that left from two (bin, batch) goes back as the same split, largest first', () => {
    const r = resolve(
      [line({ quantity: 5 })],
      [
        packed({ id: 'm-1', qtyChange: -2 }),
        packed({ id: 'm-2', binId: 'bin-B', batchId: 'bat-B', qtyChange: -3 }),
      ],
    );
    const sources = r.resolved[0]?.sources ?? [];
    expect(sources).toEqual([
      { warehouseId: WH, binId: 'bin-B', batchId: 'bat-B', quantity: 3 },
      { warehouseId: WH, binId: 'bin-A', batchId: 'bat-A', quantity: 2 },
    ]);
    expect(sources.reduce((s, x) => s + x.quantity, 0)).toBe(5);
  });

  it('a PACK_REVERSED give-back is netted out', () => {
    // m-1 was reversed (cancel-while-packed), m-2 is the re-pack that
    // actually left the building.
    const r = resolve(
      [line()],
      [packed({ id: 'm-1' }), packed({ id: 'm-2', binId: 'bin-B', batchId: 'bat-B' })],
      ['m-1'],
    );
    expect(r.resolved[0]?.sources).toEqual([
      { warehouseId: WH, binId: 'bin-B', batchId: 'bat-B', quantity: 2 },
    ]);
  });

  it('a hint that agrees changes nothing; one that disagrees loses to the movement and is flagged', () => {
    const agrees = resolve([line({ pickedBinId: 'bin-A', pickedBatchId: 'bat-A' })], [packed()]);
    expect(agrees.resolved[0]).toMatchObject({ origin: 'PACK_MOVEMENT', hintDisagrees: false });

    const disagrees = resolve([line({ pickedBinId: 'bin-Z', pickedBatchId: 'bat-Z' })], [packed()]);
    expect(disagrees.resolved[0]).toMatchObject({
      origin: 'PACK_MOVEMENT',
      hintDisagrees: true,
      sources: [{ binId: 'bin-A', batchId: 'bat-A', quantity: 2 }],
    });
  });

  it('hint present with no pack evidence → the legacy hint path at the origin warehouse', () => {
    const r = resolve([line({ pickedBinId: 'bin-H', pickedBatchId: 'bat-H', quantity: 3 })], []);
    expect(r.resolved[0]).toEqual({
      shipmentItemId: 'si-1',
      origin: 'PICK_HINT',
      sources: [{ warehouseId: WH, binId: 'bin-H', batchId: 'bat-H', quantity: 3 }],
      hintDisagrees: false,
    });
  });

  it('no hint and no net pack evidence → never left stock', () => {
    expect(resolve([line()], []).neverLeft).toEqual(['si-1']);
    // Fully given back is the same as never having left.
    expect(resolve([line()], [packed()], ['m-1']).neverLeft).toEqual(['si-1']);
  });

  it('less left than the line claims → a shortfall, never a partial restock', () => {
    const r = resolve([line({ quantity: 3 })], [packed({ qtyChange: -2 })]);
    expect(r.resolved).toEqual([]);
    expect(r.shortfalls).toEqual([{ shipmentItemId: 'si-1', quantity: 3, leftQuantity: 2 }]);
  });

  it('matches by order item, so another line of the same order cannot claim it', () => {
    const r = resolve(
      [line(), line({ shipmentItemId: 'si-2', orderItemId: 'oi-2', variantId: 'v-2' })],
      [packed()],
    );
    expect(r.resolved.map((x) => x.shipmentItemId)).toEqual(['si-1']);
    expect(r.neverLeft).toEqual(['si-2']);
  });

  it('a movement naming no order item is a per-variant pool, consumed as lines draw on it', () => {
    const r = resolve(
      [line({ quantity: 2 }), line({ shipmentItemId: 'si-2', orderItemId: 'oi-2', quantity: 2 })],
      [packed({ orderItemId: null, qtyChange: -3 })],
    );
    expect(r.resolved[0]?.sources[0]?.quantity).toBe(2);
    // Only one unit is left in the pool for the second line.
    expect(r.shortfalls).toEqual([{ shipmentItemId: 'si-2', quantity: 2, leftQuantity: 1 }]);
  });

  it('allowPartial (the WMS-8e receive booking): less left than the line → books exactly what left', () => {
    const r = resolveRestockSources({
      lines: [line({ quantity: 3 })],
      leftMovements: [packed({ qtyChange: -2 })],
      reversedMovementIds: new Set(),
      originWarehouseId: WH,
      allowPartial: true,
    });
    expect(r.shortfalls).toEqual([]);
    expect(r.resolved[0]?.sources).toEqual([
      { warehouseId: WH, binId: 'bin-A', batchId: 'bat-A', quantity: 2 },
    ]);
  });

  it('keeps the warehouse the stock left from (R6b decides same vs cross from it)', () => {
    const r = resolve([line()], [packed({ warehouseId: 'wh-2' })]);
    expect(r.resolved[0]?.sources[0]?.warehouseId).toBe('wh-2');
  });
});
