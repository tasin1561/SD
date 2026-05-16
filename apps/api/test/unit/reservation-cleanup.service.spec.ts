import { ActorType, ReservationReleaseReason, ReservationStatus } from '@skydrop/db';
import { ReservationCleanupService } from '../../src/modules/inventory-stock/services/reservation-cleanup.service';
import type { StockReservationService } from '../../src/modules/inventory-stock/services/stock-reservation.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const NOW = new Date('2026-05-16T12:00:00.000Z');
const hoursFromNow = (h: number): Date => new Date(NOW.getTime() + h * 3_600_000);

interface Row {
  id: string;
  status: ReservationStatus;
  expiresAt: Date | null;
}

function makeSut(rows: Row[], raceTerminalIds: string[] = []) {
  const store = rows.map((r) => ({ ...r }));
  const raced = new Set(raceTerminalIds);
  const findMany = jest.fn(
    async (args: { where: { status: ReservationStatus; expiresAt: { lt: Date } }; take: number }) =>
      store
        .filter(
          (r) =>
            r.status === args.where.status &&
            r.expiresAt !== null &&
            r.expiresAt.getTime() < args.where.expiresAt.lt.getTime(),
        )
        .slice(0, args.take)
        .map((r) => ({ id: r.id })),
  );
  const prisma = {
    client: { stockReservation: { findMany } },
  } as unknown as PrismaService;

  const release = jest.fn(
    async (id: string, _reason: ReservationReleaseReason, _actor: unknown, _now: Date) => {
      const row = store.find((r) => r.id === id)!;
      // Models a row that transitioned between the scan and this release.
      if (raced.has(id) || row.status !== ReservationStatus.ACTIVE) {
        return {
          reservationId: id,
          qtyReleased: 0,
          status: ReservationStatus.FULFILLED,
          alreadyInactive: true,
        };
      }
      row.status = ReservationStatus.RELEASED;
      return { reservationId: id, qtyReleased: 5, status: ReservationStatus.RELEASED, alreadyInactive: false };
    },
  );
  const reservations = { release } as unknown as StockReservationService;

  const svc = new ReservationCleanupService(prisma, reservations);
  return { svc, store, release, findMany };
}

describe('ReservationCleanupService.sweep', () => {
  it('releases only ACTIVE reservations whose expiresAt has passed', async () => {
    const { svc, store, release } = makeSut([
      { id: 'past-1', status: ReservationStatus.ACTIVE, expiresAt: hoursFromNow(-2) }, // override-shortened, expired
      { id: 'past-2', status: ReservationStatus.ACTIVE, expiresAt: hoursFromNow(-48) },
      { id: 'future', status: ReservationStatus.ACTIVE, expiresAt: hoursFromNow(+24) }, // default TTL, not yet
      { id: 'no-exp', status: ReservationStatus.ACTIVE, expiresAt: null },
      { id: 'already', status: ReservationStatus.RELEASED, expiresAt: hoursFromNow(-5) },
    ]);
    const res = await svc.sweep(NOW);
    expect(res).toEqual({ scanned: 2, released: 2, skipped: 0 });
    expect(release.mock.calls.map((c) => c[0]).sort()).toEqual(['past-1', 'past-2']);
    // Each released with EXPIRED + SYSTEM + the sweep's `now`.
    expect(release).toHaveBeenCalledWith(
      'past-1',
      ReservationReleaseReason.EXPIRED,
      { type: ActorType.SYSTEM },
      NOW,
    );
    expect(store.find((r) => r.id === 'future')?.status).toBe(ReservationStatus.ACTIVE);
  });

  it('counts an idempotent (already-terminal) release as skipped', async () => {
    // ACTIVE + expired at scan time, but races to terminal before release.
    const { svc } = makeSut(
      [{ id: 'r1', status: ReservationStatus.ACTIVE, expiresAt: hoursFromNow(-1) }],
      ['r1'],
    );
    const res = await svc.sweep(NOW);
    expect(res).toEqual({ scanned: 1, released: 0, skipped: 1 });
  });

  it('no due reservations -> zero counts', async () => {
    const { svc } = makeSut([
      { id: 'future', status: ReservationStatus.ACTIVE, expiresAt: hoursFromNow(+10) },
    ]);
    expect(await svc.sweep(NOW)).toEqual({ scanned: 0, released: 0, skipped: 0 });
  });
});
