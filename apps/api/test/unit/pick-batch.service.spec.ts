import { InventoryMode, PickBatchStatus } from '@skydrop/db';
import { PickBatchService } from '../../src/modules/warehouse-printing/services/pick-batch.service';
import { PickListPdfService } from '../../src/modules/warehouse-printing/services/pick-list-pdf.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { PickBatchNumberingService } from '../../src/modules/warehouse-printing/services/pick-batch-numbering.service';
import type { PickAllocationService } from '../../src/modules/pick-allocation/pick-allocation.service';
import type { StockReservationService } from '../../src/modules/inventory-stock/services/stock-reservation.service';
import type { InventoryModeService } from '../../src/modules/inventory-shared/inventory-mode.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';

type Any = Record<string, unknown>;

function shipment(over: Any = {}): Any {
  return {
    id: 's1',
    shipmentNumber: 'SH-1',
    status: 'CREATED',
    labelPrintedAt: new Date('2026-09-03T08:00:00Z'),
    pickBatchId: null,
    originWarehouseId: 'wh-1',
    ...over,
  };
}

function makeService(opts: {
  shipments?: Any[];
  reservations?: Any[];
  mode?: InventoryMode;
  claimCount?: number;
}) {
  const shipments = opts.shipments ?? [shipment()];
  const shipmentUpdateMany = jest.fn(async () => ({
    count: opts.claimCount ?? shipments.length,
  }));
  const created: Any = {
    id: 'b1',
    batchNumber: 'PB-2026-09-000001',
    createdAt: new Date('2026-09-03T09:00:00Z'),
  };

  const batchRow = {
    ...created,
    status: PickBatchStatus.DRAFT,
    warehouseId: 'wh-1',
    printedAt: null,
    warehouse: { name: 'Kolkata Main' },
    createdBy: { emailDisplay: 'ops@skydrop', email: 'ops@skydrop' },
    printedBy: null,
    shipments: shipments.map((s) => ({
      id: s['id'],
      shipmentNumber: s['shipmentNumber'],
      awbNumber: 'AWB1',
      orderShipments: [{ order: { orderNumber: 'SD-1' }, orderId: 'o1' }],
    })),
  };

  const tx = {
    pickBatch: {
      create: jest.fn(async () => created),
      findUniqueOrThrow: jest.fn(async () => batchRow),
    },
    shipment: { updateMany: shipmentUpdateMany },
  };

  const client = {
    shipment: { findMany: jest.fn(async () => shipments), updateMany: shipmentUpdateMany },
    pickBatch: {
      findUnique: jest.fn(async () => batchRow),
      findMany: jest.fn(async () => [batchRow]),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    stockReservation: { findMany: jest.fn(async () => opts.reservations ?? []) },
    orderShipment: { findMany: jest.fn(async () => [{ orderId: 'o1', shipmentId: 's1' }]) },
    staffUser: { findUnique: jest.fn(async () => ({ emailDisplay: 'ops', email: 'ops' })) },
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  };

  const allocateForPick = jest.fn(async () => ({}) as never);
  const svc = new PickBatchService(
    { client } as unknown as PrismaService,
    { log: jest.fn() } as unknown as AuditLogService,
    {
      nextBatchNumber: jest.fn(async () => 'PB-2026-09-000001'),
    } as unknown as PickBatchNumberingService,
    { allocateForPick } as unknown as PickAllocationService,
    {
      listActiveForOrderWithLocations: jest.fn(async () => opts.reservations ?? []),
    } as unknown as StockReservationService,
    {
      resolveForVariant: jest.fn(async () => opts.mode ?? InventoryMode.NORMAL),
    } as unknown as InventoryModeService,
    {
      transitionStatus: jest.fn(async () => ({ status: 'PENDING_PICK' })),
    } as unknown as OrderWriteService,
    new PickListPdfService(),
  );
  return { svc, shipmentUpdateMany, allocateForPick, client };
}

describe('PickBatchService.create — a batch is a walk', () => {
  it('refuses a parcel whose label is not printed yet', async () => {
    // A picked parcel with no label sits on the bench with nothing
    // saying where it goes. The label is what makes it actionable.
    const { svc } = makeService({ shipments: [shipment({ labelPrintedAt: null })] });
    await expect(svc.create(['s1'], 'staff-1')).rejects.toMatchObject({
      response: { code: 'LABEL_NOT_PRINTED' },
    });
  });

  it('refuses to mix warehouses on one sheet', async () => {
    // A sheet listing shelves in two buildings cannot be walked by one
    // person, and the bin codes would collide.
    const { svc } = makeService({
      shipments: [shipment(), shipment({ id: 's2', originWarehouseId: 'wh-2' })],
    });
    await expect(svc.create(['s1', 's2'], 'staff-1')).rejects.toMatchObject({
      response: { code: 'MIXED_WAREHOUSES' },
    });
  });

  it('refuses a parcel already on another batch', async () => {
    const { svc } = makeService({ shipments: [shipment({ pickBatchId: 'other' })] });
    await expect(svc.create(['s1'], 'staff-1')).rejects.toMatchObject({
      response: { code: 'ALREADY_BATCHED' },
    });
  });

  it('claims with a guarded updateMany, and gives up if it lost the race', async () => {
    // Two supervisors building batches at the same desk would otherwise
    // both read "unbatched" and both claim the same parcel — and the
    // second sheet would send somebody after goods already on a trolley.
    const { svc, shipmentUpdateMany } = makeService({ claimCount: 0 });
    await expect(svc.create(['s1'], 'staff-1')).rejects.toMatchObject({
      response: { code: 'BATCH_CLAIM_LOST' },
    });
    expect(shipmentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ pickBatchId: null }) }),
    );
  });
});

describe('PickBatchService.buildList — the sheet', () => {
  const reservation = (over: Any = {}): Any => ({
    id: 'r1',
    qtyReserved: 2,
    variantId: 'v1',
    sellerId: 'sel-1',
    binId: 'bin-1',
    batchId: 'sb-1',
    orderId: 'o1',
    bin: { code: 'A-01-03', zone: { name: 'Ground' } },
    variant: {
      skuCode: 'SKU-1',
      barcode: '8901234567890',
      variantLabel: 'Black',
      product: { name: 'Aviator' },
    },
    ...over,
  });

  it('allocates so the printed locations are real, not a guess', async () => {
    const { svc, allocateForPick } = makeService({
      reservations: [reservation({ binId: null, batchId: null, bin: null })],
    });
    await svc.buildList('b1', 'staff-1');
    expect(allocateForPick).toHaveBeenCalled();
  });

  it('does not re-allocate a line that is already on a shelf', async () => {
    const { svc, allocateForPick } = makeService({ reservations: [reservation()] });
    await svc.buildList('b1', 'staff-1');
    expect(allocateForPick).not.toHaveBeenCalled();
  });

  it('names a shortfall instead of failing the whole sheet', async () => {
    // The rest of the batch is still walkable, and a picker who knows
    // one line is short can bring the others back.
    const { svc, allocateForPick } = makeService({
      reservations: [reservation({ binId: null, batchId: null, bin: null })],
    });
    allocateForPick.mockRejectedValueOnce(new Error('PICK_ALLOCATION_RETRY_EXHAUSTED'));
    const r = await svc.buildList('b1', 'staff-1');
    expect(r.shortfalls).toHaveLength(1);
    expect(r.pdfBase64.length).toBeGreaterThan(0);
  });

  it('produces a real A4 PDF', async () => {
    const { svc } = makeService({ reservations: [reservation()] });
    const r = await svc.buildList('b1', 'staff-1');
    const head = Buffer.from(r.pdfBase64, 'base64').subarray(0, 5).toString();
    expect(head).toBe('%PDF-');
    expect(r.fileName).toContain('PB-2026-09');
  });

  it('STRICT mode withholds the SKU barcode', async () => {
    // In strict mode every unit carries its own serial and the scan is
    // against THAT (UNIT-2). Printing a SKU barcode invites scanning the
    // wrong thing and having it accepted.
    const { svc } = makeService({
      reservations: [reservation()],
      mode: InventoryMode.STRICT,
    });
    const r = await svc.buildList('b1', 'staff-1');
    expect(r.strictMode).toBe(true);
  });

  it('NORMAL mode carries the barcode, for scanning at the packing table', async () => {
    const { svc } = makeService({ reservations: [reservation()], mode: InventoryMode.NORMAL });
    const r = await svc.buildList('b1', 'staff-1');
    expect(r.strictMode).toBe(false);
  });

  it('one row per variant PER BIN — the same SKU in two bins is two walks', async () => {
    const { svc } = makeService({
      reservations: [
        reservation({ binId: 'bin-1', bin: { code: 'A-01-03', zone: null } }),
        reservation({ id: 'r2', binId: 'bin-2', bin: { code: 'B-02-01', zone: null } }),
      ],
    });
    const r = await svc.buildList('b1', 'staff-1');
    expect(r.lineCount).toBe(2);
  });

  it('merges the same variant in the SAME bin into one row', async () => {
    const { svc } = makeService({
      reservations: [reservation(), reservation({ id: 'r2', orderId: 'o1' })],
    });
    const r = await svc.buildList('b1', 'staff-1');
    expect(r.lineCount).toBe(1);
  });
});
