import { InventoryWarehouseService } from '../../src/modules/inventory-warehouse/services/inventory-warehouse.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';

type Any = Record<string, unknown>;

const CTX = { ipAddress: '1.1.1.1', userAgent: 'jest', requestId: 'r1' };

/**
 * `fulfilsOrders` decides whether a building's stock is sellable at all
 * (CNS-2). Two properties matter and neither is obvious from the column.
 */
function makeSut(opts: { activeReservations?: number } = {}) {
  const updates: Any[] = [];
  const creates: Any[] = [];
  const row = {
    id: 'w1',
    code: 'DAC-01',
    name: 'Dhaka Intake',
    status: 'ACTIVE',
    countryCode: 'BD',
    timezone: 'Asia/Dhaka',
    binTrackingEnabled: false,
    fulfilsOrders: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const client: Any = {
    warehouse: {
      findFirst: async () => row,
      findUnique: async () => row,
      create: async (args: Any) => {
        creates.push((args as { data: Any }).data);
        return { ...row, ...(args as { data: Any }).data };
      },
      update: async (args: Any) => {
        updates.push((args as { data: Any }).data);
        return { ...row, ...(args as { data: Any }).data };
      },
    },
    stockReservation: { count: async () => opts.activeReservations ?? 0 },
    warehouseZone: { findFirst: async () => ({ id: 'z1' }), create: async () => ({ id: 'z1' }) },
    warehouseBin: { findFirst: async () => ({ id: 'b1' }), create: async () => ({ id: 'b1' }) },
    auditLog: { create: async () => ({ id: 'a1' }) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  };
  const svc = new InventoryWarehouseService(
    { client } as unknown as PrismaService,
    { log: async () => undefined } as unknown as AuditLogService,
    // The resolver answers "which warehouse" questions; nothing under
    // test asks one.
    {} as never,
  );
  return { svc, updates, creates };
}

describe('Warehouse.fulfilsOrders', () => {
  it('is settable at CREATE — an intake site is never briefly sellable', async () => {
    // The window matters: create-then-toggle would leave a moment in
    // which Dhaka stock is offered to customers in India.
    const sut = makeSut();
    await sut.svc.createWarehouse(
      'staff1',
      { code: 'DAC-01', name: 'Dhaka Intake', countryCode: 'BD', fulfilsOrders: false },
      CTX,
    );
    expect(sut.creates[0]).toMatchObject({ fulfilsOrders: false, countryCode: 'BD' });
  });

  it('defaults to true, so every existing warehouse keeps shipping', async () => {
    const sut = makeSut();
    await sut.svc.createWarehouse('staff1', { code: 'BLR-02', name: 'Second' }, CTX);
    expect(sut.creates[0]).toMatchObject({ fulfilsOrders: true });
  });

  it('refuses to be turned OFF while orders are committed to ship from here', async () => {
    // Flipping it would make their stock unreachable to the allocator, so
    // every one of those orders would shortfall on the warehouse floor
    // rather than fail somewhere a person could see why.
    const sut = makeSut({ activeReservations: 4 });
    await expect(
      sut.svc.updateWarehouse('staff1', 'w1', { fulfilsOrders: false }, CTX),
    ).rejects.toMatchObject({ response: { code: 'WAREHOUSE_HAS_ACTIVE_RESERVATIONS' } });
    expect(sut.updates).toHaveLength(0);
  });

  it('turns OFF freely once nothing is held', async () => {
    const sut = makeSut({ activeReservations: 0 });
    await sut.svc.updateWarehouse('staff1', 'w1', { fulfilsOrders: false }, CTX);
    expect(sut.updates[0]).toMatchObject({ fulfilsOrders: false });
  });

  it('turning it ON is unguarded — it only ever makes more stock sellable', async () => {
    const sut = makeSut({ activeReservations: 99 });
    await sut.svc.updateWarehouse('staff1', 'w1', { fulfilsOrders: true }, CTX);
    expect(sut.updates[0]).toMatchObject({ fulfilsOrders: true });
  });
});
