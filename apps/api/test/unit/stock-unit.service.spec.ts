import { ActorType, StockUnitStatus } from '@skydrop/db';
import {
  StockUnitService,
  UnitScanRejectedError,
} from '../../src/modules/inventory-shared/stock-unit.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type AnyArgs = Record<string, unknown>;

const SELLER = 'seller-1';
const VARIANT = 'v-1';
const WH = 'wh-1';

interface UnitRow {
  id: string;
  serialBarcode: string;
  variantId: string;
  status: StockUnitStatus;
  warehouseId: string;
  shipmentItemId?: string | null;
}

/**
 * In-memory fake of the two unit tables. The service's contract is
 * "unit rows + an append-only event per change", so the fake tracks both
 * and the assertions check the pair — a status change with no event row
 * would be a silent hole in the audit trail.
 */
function makeSut(seed: UnitRow[] = []) {
  const units = new Map(seed.map((u) => [u.id, { ...u }]));
  const events: AnyArgs[] = [];
  let seq = 0;

  const bySerial = (serial: string): UnitRow | undefined =>
    [...units.values()].find((u) => u.serialBarcode === serial);

  const tx = {
    stockUnit: {
      create: jest.fn(async (args: { data: AnyArgs }) => {
        const serial = String(args.data['serialBarcode']);
        if (bySerial(serial)) {
          const err = Object.assign(new Error('unique'), { code: 'P2002' });
          Object.setPrototypeOf(
            err,
            // The service narrows on Prisma's known-request-error class;
            // mimic it structurally via the real constructor name check.
            Object.getPrototypeOf(err),
          );
          throw err;
        }
        seq += 1;
        const row: UnitRow = {
          id: `u-${seq}`,
          serialBarcode: serial,
          variantId: String(args.data['variantId']),
          status: args.data['status'] as StockUnitStatus,
          warehouseId: String(args.data['warehouseId']),
          shipmentItemId: null,
        };
        units.set(row.id, row);
        return { id: row.id };
      }),
      // Reads return COPIES, like real Prisma: the service captures
      // `unit.status` as the event's fromStatus BEFORE updating, and a
      // live-object fake would silently show the post-update value.
      findUnique: jest.fn(async (args: AnyArgs) => {
        const where = args['where'] as AnyArgs;
        const key = where['sellerId_serialBarcode'] as AnyArgs | undefined;
        const row = key ? bySerial(String(key['serialBarcode'])) : units.get(String(where['id']));
        return row === undefined ? null : { ...row };
      }),
      findMany: jest.fn(async (args: AnyArgs) => {
        const where = (args['where'] ?? {}) as AnyArgs;
        return [...units.values()]
          .filter((u) => where['status'] === undefined || u.status === where['status'])
          .map((u) => ({ ...u }));
      }),
      update: jest.fn(async (args: { where: { id: string }; data: AnyArgs }) => {
        const row = units.get(args.where.id);
        if (!row) throw new Error('missing unit');
        if (args.data['status'] !== undefined) {
          row.status = args.data['status'] as StockUnitStatus;
        }
        if (args.data['shipmentItemId'] !== undefined) {
          row.shipmentItemId = args.data['shipmentItemId'] as string | null;
        }
        if (args.data['warehouseId'] !== undefined) {
          row.warehouseId = String(args.data['warehouseId']);
        }
        return row;
      }),
    },
    stockUnitEvent: {
      create: jest.fn(async (args: { data: AnyArgs }) => {
        events.push(args.data);
        return { id: `e-${events.length}` };
      }),
    },
  };

  const prisma = { client: tx } as unknown as PrismaService;
  const svc = new StockUnitService(prisma);
  return { svc, tx, units, events };
}

const TX = (sut: ReturnType<typeof makeSut>) =>
  sut.tx as unknown as Parameters<StockUnitService['registerUnits']>[0];

const INTAKE = {
  sellerId: SELLER,
  variantId: VARIANT,
  warehouseId: WH,
  actorType: ActorType.STAFF,
  actorId: 'staff-1',
};

describe('StockUnitService.registerUnits', () => {
  it('generates a serial per unit when the supplier printed none', async () => {
    const sut = makeSut();
    const out = await sut.svc.registerUnits(TX(sut), {
      ...INTAKE,
      quantity: 3,
      serialPrefix: 'ACME',
    });
    expect(out).toHaveLength(3);
    expect(out.every((u) => u.isSystemGenerated)).toBe(true);
    expect(out.every((u) => u.serialBarcode.startsWith('ACME-'))).toBe(true);
    // Generated serials must be distinct — a duplicate would make two
    // physical units indistinguishable.
    expect(new Set(out.map((u) => u.serialBarcode)).size).toBe(3);
    // Every registration appends an event (append-only audit trail).
    expect(sut.events).toHaveLength(3);
    expect(sut.events[0]).toMatchObject({
      toStatus: StockUnitStatus.IN_STOCK,
      gate: 'RECEIVING',
      fromStatus: null,
    });
  });

  it('uses supplied serials and marks them as NOT system-generated', async () => {
    const sut = makeSut();
    const out = await sut.svc.registerUnits(TX(sut), {
      ...INTAKE,
      quantity: 2,
      serials: ['SUP-1', 'SUP-2'],
    });
    expect(out.map((u) => u.serialBarcode)).toEqual(['SUP-1', 'SUP-2']);
    expect(out.every((u) => !u.isSystemGenerated)).toBe(true);
  });

  it('fills the gap: fewer serials than units generates the remainder', async () => {
    const sut = makeSut();
    const out = await sut.svc.registerUnits(TX(sut), {
      ...INTAKE,
      quantity: 3,
      serials: ['SUP-1'],
      serialPrefix: 'SDU',
    });
    expect(out[0]).toMatchObject({ serialBarcode: 'SUP-1', isSystemGenerated: false });
    expect(out[1]?.isSystemGenerated).toBe(true);
    expect(out[2]?.isSystemGenerated).toBe(true);
  });

  it('rejects more serials than units', async () => {
    const sut = makeSut();
    await expect(
      sut.svc.registerUnits(TX(sut), {
        ...INTAKE,
        quantity: 1,
        serials: ['A', 'B'],
      }),
    ).rejects.toMatchObject({ response: { code: 'UNIT_SERIAL_COUNT_MISMATCH' } });
  });

  it('rejects a serial repeated within one intake', async () => {
    const sut = makeSut();
    await expect(
      sut.svc.registerUnits(TX(sut), {
        ...INTAKE,
        quantity: 2,
        serials: ['A', 'A'],
      }),
    ).rejects.toMatchObject({ response: { code: 'UNIT_SERIAL_DUPLICATED' } });
  });

  it('rejects a non-positive quantity', async () => {
    const sut = makeSut();
    await expect(sut.svc.registerUnits(TX(sut), { ...INTAKE, quantity: 0 })).rejects.toMatchObject({
      response: { code: 'UNIT_QUANTITY_INVALID' },
    });
  });
});

describe('StockUnitService.scanUnits (the pick gate)', () => {
  const seed: UnitRow[] = [
    {
      id: 'u-1',
      serialBarcode: 'S1',
      variantId: VARIANT,
      status: StockUnitStatus.IN_STOCK,
      warehouseId: WH,
    },
    {
      id: 'u-2',
      serialBarcode: 'S2',
      variantId: VARIANT,
      status: StockUnitStatus.IN_STOCK,
      warehouseId: WH,
    },
  ];
  const base = {
    sellerId: SELLER,
    variantId: VARIANT,
    fromStatus: StockUnitStatus.IN_STOCK,
    toStatus: StockUnitStatus.PICKED,
    gate: 'PICK',
    actorType: ActorType.STAFF,
    actorId: 'staff-1',
  };

  it('moves each scanned unit and appends one event per unit', async () => {
    const sut = makeSut(seed);
    const ids = await sut.svc.scanUnits(TX(sut), {
      ...base,
      serials: ['S1', 'S2'],
      shipmentItemId: 'si-1',
      warehouseId: WH,
    });
    expect(ids).toEqual(['u-1', 'u-2']);
    expect([...sut.units.values()].map((u) => u.status)).toEqual([
      StockUnitStatus.PICKED,
      StockUnitStatus.PICKED,
    ]);
    expect(sut.units.get('u-1')?.shipmentItemId).toBe('si-1');
    expect(sut.events).toHaveLength(2);
    expect(sut.events[0]).toMatchObject({
      fromStatus: StockUnitStatus.IN_STOCK,
      toStatus: StockUnitStatus.PICKED,
      gate: 'PICK',
    });
  });

  it('rejects an unknown serial', async () => {
    const sut = makeSut(seed);
    await expect(sut.svc.scanUnits(TX(sut), { ...base, serials: ['NOPE'] })).rejects.toMatchObject({
      response: { code: 'UNIT_NOT_FOUND' },
    });
  });

  it('rejects a serial belonging to a different SKU — the swap that a count check would miss', async () => {
    const sut = makeSut([
      {
        id: 'u-9',
        serialBarcode: 'OTHER',
        variantId: 'v-other',
        status: StockUnitStatus.IN_STOCK,
        warehouseId: WH,
      },
    ]);
    await expect(
      sut.svc.scanUnits(TX(sut), { ...base, serials: ['OTHER'] }),
    ).rejects.toBeInstanceOf(UnitScanRejectedError);
    // Nothing moved.
    expect(sut.units.get('u-9')?.status).toBe(StockUnitStatus.IN_STOCK);
    expect(sut.events).toHaveLength(0);
  });

  it('rejects a unit in the wrong state (already picked onto another parcel)', async () => {
    const sut = makeSut([
      {
        id: 'u-1',
        serialBarcode: 'S1',
        variantId: VARIANT,
        status: StockUnitStatus.PICKED,
        warehouseId: WH,
      },
    ]);
    await expect(sut.svc.scanUnits(TX(sut), { ...base, serials: ['S1'] })).rejects.toMatchObject({
      response: { code: 'UNIT_WRONG_STATUS' },
    });
  });

  it('rejects a unit held at another warehouse', async () => {
    const sut = makeSut([
      {
        id: 'u-1',
        serialBarcode: 'S1',
        variantId: VARIANT,
        status: StockUnitStatus.IN_STOCK,
        warehouseId: 'wh-other',
      },
    ]);
    await expect(
      sut.svc.scanUnits(TX(sut), { ...base, serials: ['S1'], warehouseId: WH }),
    ).rejects.toMatchObject({ response: { code: 'UNIT_WRONG_WAREHOUSE' } });
  });

  it('rejects the same serial scanned twice in one submission', async () => {
    const sut = makeSut(seed);
    await expect(
      sut.svc.scanUnits(TX(sut), { ...base, serials: ['S1', 'S1'] }),
    ).rejects.toMatchObject({ response: { code: 'UNIT_SCAN_DUPLICATED' } });
  });

  it('rejects an empty scan', async () => {
    const sut = makeSut(seed);
    await expect(sut.svc.scanUnits(TX(sut), { ...base, serials: [] })).rejects.toMatchObject({
      response: { code: 'UNIT_SCAN_REQUIRED' },
    });
  });
});

describe('StockUnitService.scanUnitsForShipment (the pack gate)', () => {
  const seed: UnitRow[] = [
    {
      id: 'u-1',
      serialBarcode: 'S1',
      variantId: VARIANT,
      status: StockUnitStatus.PICKED,
      warehouseId: WH,
      shipmentItemId: 'si-1',
    },
    {
      id: 'u-2',
      serialBarcode: 'S2',
      variantId: VARIANT,
      status: StockUnitStatus.PICKED,
      warehouseId: WH,
      shipmentItemId: 'si-1',
    },
  ];
  const base = {
    sellerId: SELLER,
    shipmentId: 'ship-1',
    fromStatus: StockUnitStatus.PICKED,
    toStatus: StockUnitStatus.PACKED,
    gate: 'PACK',
    actorType: ActorType.STAFF,
    actorId: 'staff-1',
  };

  it('accepts an exact set match and moves every unit', async () => {
    const sut = makeSut(seed);
    const n = await sut.svc.scanUnitsForShipment(TX(sut), {
      ...base,
      serials: ['S2', 'S1'], // order is irrelevant; the SET is what matters
    });
    expect(n).toBe(2);
    expect([...sut.units.values()].every((u) => u.status === StockUnitStatus.PACKED)).toBe(true);
    expect(sut.events).toHaveLength(2);
  });

  it('rejects a missing unit — the box is short', async () => {
    const sut = makeSut(seed);
    await expect(
      sut.svc.scanUnitsForShipment(TX(sut), { ...base, serials: ['S1'] }),
    ).rejects.toMatchObject({
      response: { code: 'UNIT_SCAN_SET_MISMATCH', cause: { missing: ['S2'], extra: [] } },
    });
    // Nothing moved — a partial pack must not be recorded.
    expect([...sut.units.values()].every((u) => u.status === StockUnitStatus.PICKED)).toBe(true);
  });

  it('rejects an extra unit — something from another parcel is in the box', async () => {
    const sut = makeSut(seed);
    await expect(
      sut.svc.scanUnitsForShipment(TX(sut), {
        ...base,
        serials: ['S1', 'S2', 'STRAY'],
      }),
    ).rejects.toMatchObject({
      response: { code: 'UNIT_SCAN_SET_MISMATCH', cause: { missing: [], extra: ['STRAY'] } },
    });
  });
});

describe('StockUnitService.advanceUnitsForShipment (parcel-grained gates)', () => {
  it('moves only units in the expected fromStatus — a re-run is a no-op', async () => {
    const sut = makeSut([
      {
        id: 'u-1',
        serialBarcode: 'S1',
        variantId: VARIANT,
        status: StockUnitStatus.PACKED,
        warehouseId: WH,
        shipmentItemId: 'si-1',
      },
      {
        id: 'u-2',
        serialBarcode: 'S2',
        variantId: VARIANT,
        status: StockUnitStatus.DISPATCHED,
        warehouseId: WH,
        shipmentItemId: 'si-1',
      },
    ]);
    const first = await sut.svc.advanceUnitsForShipment(TX(sut), {
      shipmentId: 'ship-1',
      fromStatus: StockUnitStatus.PACKED,
      toStatus: StockUnitStatus.DISPATCHED,
      gate: 'DISPATCH',
      actorType: ActorType.STAFF,
      actorId: 'staff-1',
    });
    expect(first).toBe(1); // only the PACKED one
    const second = await sut.svc.advanceUnitsForShipment(TX(sut), {
      shipmentId: 'ship-1',
      fromStatus: StockUnitStatus.PACKED,
      toStatus: StockUnitStatus.DISPATCHED,
      gate: 'DISPATCH',
      actorType: ActorType.STAFF,
      actorId: 'staff-1',
    });
    expect(second).toBe(0); // guarded: nothing walks forward twice
    expect(sut.events).toHaveLength(1);
  });
});
