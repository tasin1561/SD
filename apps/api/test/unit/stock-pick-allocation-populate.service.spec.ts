import { ReservationStatus } from '@skydrop/db';
import { StockPickAllocationService } from '../../src/modules/inventory-stock/services/stock-pick-allocation.service';
import { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

interface Lvl {
  id: string;
  binId: string;
  batchId: string;
  qtyOnHand: number;
  qtyReserved: number;
  version: number;
  expiresAt: string;
}

function makeSut(opts: {
  levels: Lvl[];
  reservation: Record<string, unknown> | null;
  conflictUpdates?: number; // first N updateMany calls lose the version race
}) {
  const levels = opts.levels.map((l) => ({ ...l }));
  const reservations = new Map<string, Record<string, unknown>>();
  if (opts.reservation) reservations.set(opts.reservation.id as string, { ...opts.reservation });
  let createdSeq = 0;
  let conflictsLeft = opts.conflictUpdates ?? 0;
  const auditCreate = jest.fn(async () => ({ id: 'a1' }));

  const client = {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(client),
    stockLevel: {
      findMany: jest.fn(async () =>
        levels.map((l) => ({
          binId: l.binId,
          batchId: l.batchId,
          qtyOnHand: l.qtyOnHand,
          qtyReserved: l.qtyReserved,
          bin: { code: l.binId, zone: { pickOrder: 100 } },
          batch: { expiresAt: new Date(l.expiresAt), receivedAt: new Date('2026-01-01') },
        })),
      ),
      findUnique: jest.fn(async (args: { where: { sellerId_variantId_warehouseId_binId_batchId: { binId: string; batchId: string } } }) => {
        const k = args.where.sellerId_variantId_warehouseId_binId_batchId;
        const l = levels.find((x) => x.binId === k.binId && x.batchId === k.batchId);
        return l ? { id: l.id, qtyOnHand: l.qtyOnHand, qtyReserved: l.qtyReserved, version: l.version } : null;
      }),
      updateMany: jest.fn(async (args: { where: { id: string; version: number }; data: { qtyReserved: { increment: number }; version: { increment: number } } }) => {
        if (conflictsLeft > 0) {
          conflictsLeft -= 1;
          const l = levels.find((x) => x.id === args.where.id);
          if (l) l.version += 1; // phantom concurrent writer
          return { count: 0 };
        }
        const l = levels.find((x) => x.id === args.where.id && x.version === args.where.version);
        if (!l) return { count: 0 };
        l.qtyReserved += args.data.qtyReserved.increment;
        l.version += 1;
        return { count: 1 };
      }),
    },
    stockReservation: {
      findUnique: jest.fn(async (args: { where: { id: string } }) => reservations.get(args.where.id) ?? null),
      update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(reservations.get(args.where.id)!, args.data);
        return {};
      }),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        createdSeq += 1;
        const id = `new-${createdSeq}`;
        reservations.set(id, { id, ...args.data });
        return { id };
      }),
    },
    auditLog: { create: auditCreate },
  };
  const prisma = { client } as unknown as PrismaService;
  const audit = new AuditLogService(prisma);
  const svc = new StockPickAllocationService(prisma, audit);
  return { svc, levels, reservations };
}

const phase1Resv = (qty: number) => ({
  id: 'r1',
  sellerId: 's1',
  variantId: 'v1',
  warehouseId: 'w1',
  binId: null,
  batchId: null,
  qtyReserved: qty,
  orderId: 'o1',
  orderItemId: 'oi1',
  status: ReservationStatus.ACTIVE,
  expiresAt: new Date('2026-05-18T00:00:00Z'),
});

describe('StockPickAllocationService.allocateAndPopulate', () => {
  it('single pick: original phase-1 row becomes phase-2, level qtyReserved += qty', async () => {
    const { svc, levels, reservations } = makeSut({
      levels: [{ id: 'L1', binId: 'b1', batchId: 'B1', qtyOnHand: 10, qtyReserved: 0, version: 0, expiresAt: '2026-06-01' }],
      reservation: phase1Resv(5),
    });
    const res = await svc.allocateAndPopulate('r1');
    expect(res.strategy).toBe('SINGLE_BATCH');
    expect(res.allocatedQty).toBe(5);
    expect(res.phase2ReservationIds).toEqual(['r1']);
    expect(res.residualReservationId).toBeNull();
    expect(levels[0]?.qtyReserved).toBe(5);
    expect(reservations.get('r1')).toMatchObject({ binId: 'b1', batchId: 'B1', qtyReserved: 5 });
  });

  it('split: extra picks become new phase-2 rows; total reserved qty conserved', async () => {
    const { svc, levels, reservations } = makeSut({
      levels: [
        { id: 'L1', binId: 'b1', batchId: 'B1', qtyOnHand: 5, qtyReserved: 0, version: 0, expiresAt: '2026-06-01' },
        { id: 'L2', binId: 'b2', batchId: 'B2', qtyOnHand: 3, qtyReserved: 0, version: 0, expiresAt: '2026-07-01' },
      ],
      reservation: phase1Resv(7),
    });
    const res = await svc.allocateAndPopulate('r1');
    expect(res.strategy).toBe('SPLIT');
    expect(res.phase2ReservationIds).toHaveLength(2);
    expect(res.residualReservationId).toBeNull();
    // Conservation: 5 (r1->B1) + 2 (new->B2) = 7
    const total = [...reservations.values()]
      .filter((r) => r.status === ReservationStatus.ACTIVE)
      .reduce((s, r) => s + (r.qtyReserved as number), 0);
    expect(total).toBe(7);
    expect(levels.find((l) => l.id === 'L1')?.qtyReserved).toBe(5);
    expect(levels.find((l) => l.id === 'L2')?.qtyReserved).toBe(2);
  });

  it('partial: shortfall kept as residual phase-1 row (qty conserved)', async () => {
    const { svc, reservations } = makeSut({
      levels: [{ id: 'L1', binId: 'b1', batchId: 'B1', qtyOnHand: 3, qtyReserved: 0, version: 0, expiresAt: '2026-06-01' }],
      reservation: phase1Resv(10),
    });
    const res = await svc.allocateAndPopulate('r1');
    expect(res.strategy).toBe('PARTIAL');
    expect(res.allocatedQty).toBe(3);
    expect(res.shortfall).toBe(7);
    expect(res.residualReservationId).not.toBeNull();
    const total = [...reservations.values()].reduce((s, r) => s + (r.qtyReserved as number), 0);
    expect(total).toBe(10); // 3 phase-2 + 7 residual phase-1
  });

  it('idempotent: an already phase-2 reservation is returned untouched', async () => {
    const { svc, levels } = makeSut({
      levels: [{ id: 'L1', binId: 'b1', batchId: 'B1', qtyOnHand: 10, qtyReserved: 0, version: 0, expiresAt: '2026-06-01' }],
      reservation: { ...phase1Resv(5), binId: 'b1', batchId: 'B1' },
    });
    const res = await svc.allocateAndPopulate('r1');
    expect(res.alreadyAllocated).toBe(true);
    expect(levels[0]?.qtyReserved).toBe(0); // no double increment
  });

  it('rejects a non-ACTIVE reservation', async () => {
    const { svc } = makeSut({
      levels: [],
      reservation: { ...phase1Resv(5), status: ReservationStatus.RELEASED },
    });
    await expect(svc.allocateAndPopulate('r1')).rejects.toMatchObject({
      response: { code: 'RESERVATION_NOT_ACTIVE' },
    });
  });

  it('NONE when nothing pickable: leaves the phase-1 claim intact', async () => {
    const { svc, reservations } = makeSut({ levels: [], reservation: phase1Resv(5) });
    const res = await svc.allocateAndPopulate('r1');
    expect(res.strategy).toBe('NONE');
    expect(res.residualReservationId).toBe('r1');
    expect(reservations.get('r1')).toMatchObject({ binId: null, qtyReserved: 5 });
  });

  it('retries the whole plan on a version conflict, then succeeds', async () => {
    const { svc, levels } = makeSut({
      levels: [{ id: 'L1', binId: 'b1', batchId: 'B1', qtyOnHand: 10, qtyReserved: 0, version: 0, expiresAt: '2026-06-01' }],
      reservation: phase1Resv(4),
      conflictUpdates: 1,
    });
    const res = await svc.allocateAndPopulate('r1');
    expect(res.allocatedQty).toBe(4);
    expect(levels[0]?.qtyReserved).toBe(4);
  });

  it('throws PICK_ALLOCATION_CONFLICT after exhausting retries', async () => {
    const { svc } = makeSut({
      levels: [{ id: 'L1', binId: 'b1', batchId: 'B1', qtyOnHand: 10, qtyReserved: 0, version: 0, expiresAt: '2026-06-01' }],
      reservation: phase1Resv(4),
      conflictUpdates: 99,
    });
    await expect(svc.allocateAndPopulate('r1')).rejects.toMatchObject({
      response: { code: 'PICK_ALLOCATION_CONFLICT' },
    });
  });
});
