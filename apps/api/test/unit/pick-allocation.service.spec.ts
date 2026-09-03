import { ConflictException, NotFoundException } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { PickAllocationService } from '../../src/modules/pick-allocation/pick-allocation.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type {
  StockPickAllocationService,
  AppliedAllocation,
} from '../../src/modules/inventory-stock/services/stock-pick-allocation.service';

type AnyArgs = Record<string, unknown>;

const APPLIED: AppliedAllocation = {
  reservationId: 'r1',
  strategy: 'SINGLE_BATCH',
  allocatedQty: 5,
  shortfall: 0,
  phase2ReservationIds: ['r1'],
  residualReservationId: null,
  alreadyAllocated: false,
};

const m5Conflict = (): ConflictException =>
  new ConflictException({
    code: 'PICK_ALLOCATION_CONFLICT',
    message: 'contended',
  });

function makeService(
  opts: {
    retryMax?: number; // undefined → no row → default 3
    backoff?: number[] | 'absent' | 'invalid'; // undefined → seeded [100,250,500]
    allocate?: jest.Mock;
  } = {},
) {
  const findUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async (args) => {
    const key = (args.where as { key: string }).key;
    if (key === 'ops.pick_allocation_retry_max') {
      return opts.retryMax === undefined ? null : { valueInt: opts.retryMax };
    }
    if (key === 'ops.pick_allocation_retry_backoff_ms') {
      if (opts.backoff === undefined) return { valueJson: [100, 250, 500] };
      if (opts.backoff === 'absent') return null;
      if (opts.backoff === 'invalid') return { valueJson: 'nope' };
      return { valueJson: opts.backoff };
    }
    return null;
  });
  const client = { systemSetting: { findUnique } };
  const allocateAndPopulate =
    opts.allocate ?? jest.fn<Promise<AppliedAllocation>, [string, AnyArgs]>(async () => APPLIED);
  const alloc = { allocateAndPopulate };

  const svc = new PickAllocationService(
    { client } as unknown as PrismaService,
    alloc as unknown as StockPickAllocationService,
  );
  const delay = jest
    .spyOn(svc as unknown as { delay(ms: number): Promise<void> }, 'delay')
    .mockResolvedValue(undefined);
  return { svc, allocateAndPopulate, findUnique, delay };
}

describe('PickAllocationService.allocateForPick (WMS-3)', () => {
  it('returns the M5 result on first success — no retry, no backoff', async () => {
    const { svc, allocateAndPopulate, delay } = makeService();
    const r = await svc.allocateForPick('r1');
    expect(r).toBe(APPLIED);
    expect(allocateAndPopulate).toHaveBeenCalledTimes(1);
    expect(allocateAndPopulate).toHaveBeenCalledWith('r1', {
      type: ActorType.SYSTEM,
    });
    expect(delay).not.toHaveBeenCalled();
  });

  it('passes a legitimate strategy-NONE result straight through (no retry)', async () => {
    const none: AppliedAllocation = {
      reservationId: 'r1',
      strategy: 'NONE',
      allocatedQty: 0,
      shortfall: 7,
      phase2ReservationIds: [],
      residualReservationId: 'r1',
      alreadyAllocated: false,
    };
    const allocate = jest.fn(async () => none);
    const { svc, delay } = makeService({ allocate });
    const r = await svc.allocateForPick('r1');
    expect(r).toBe(none); // "stock not arrived" is not retryable
    expect(allocate).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('rethrows a deterministic 404 immediately (not retryable)', async () => {
    const allocate = jest.fn(async () => {
      throw new NotFoundException({ code: 'RESERVATION_NOT_FOUND' });
    });
    const { svc, delay } = makeService({ allocate });
    await expect(svc.allocateForPick('r1')).rejects.toBeInstanceOf(NotFoundException);
    expect(allocate).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('rethrows a non-matching ConflictException immediately', async () => {
    const allocate = jest.fn(async () => {
      throw new ConflictException({ code: 'RESERVATION_NOT_ACTIVE' });
    });
    const { svc, delay } = makeService({ allocate });
    await expect(svc.allocateForPick('r1')).rejects.toMatchObject({
      response: { code: 'RESERVATION_NOT_ACTIVE' },
    });
    expect(allocate).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('retries PICK_ALLOCATION_CONFLICT with backoff, then succeeds', async () => {
    const allocate = jest
      .fn<Promise<AppliedAllocation>, [string, AnyArgs]>()
      .mockRejectedValueOnce(m5Conflict())
      .mockRejectedValueOnce(m5Conflict())
      .mockResolvedValueOnce(APPLIED);
    const { svc, delay } = makeService({ allocate });
    const r = await svc.allocateForPick('r1');
    expect(r).toBe(APPLIED);
    expect(allocate).toHaveBeenCalledTimes(3);
    expect(delay.mock.calls.map((c) => c[0])).toEqual([100, 250]); // between attempts only
  });

  it('throws PICK_ALLOCATION_RETRY_EXHAUSTED after max attempts', async () => {
    const allocate = jest.fn(async () => {
      throw m5Conflict();
    });
    const { svc, allocateAndPopulate, delay } = makeService({ allocate });
    await expect(svc.allocateForPick('r1')).rejects.toMatchObject({
      response: { code: 'PICK_ALLOCATION_RETRY_EXHAUSTED' },
    });
    expect(allocateAndPopulate).toHaveBeenCalledTimes(3); // default max
    expect(delay).toHaveBeenCalledTimes(2); // max-1 backoffs
  });

  it('honours custom retry max + backoff settings', async () => {
    const allocate = jest.fn(async () => {
      throw m5Conflict();
    });
    const { svc, allocateAndPopulate, delay } = makeService({
      allocate,
      retryMax: 2,
      backoff: [40],
    });
    await expect(svc.allocateForPick('r1')).rejects.toMatchObject({
      response: { code: 'PICK_ALLOCATION_RETRY_EXHAUSTED' },
    });
    expect(allocateAndPopulate).toHaveBeenCalledTimes(2);
    expect(delay.mock.calls.map((c) => c[0])).toEqual([40]);
  });

  it('clamps to the last backoff entry when attempts exceed delays', async () => {
    const allocate = jest.fn(async () => {
      throw m5Conflict();
    });
    const { svc, delay } = makeService({
      allocate,
      retryMax: 5,
      backoff: [70],
    });
    await expect(svc.allocateForPick('r1')).rejects.toMatchObject({
      response: { code: 'PICK_ALLOCATION_RETRY_EXHAUSTED' },
    });
    expect(delay.mock.calls.map((c) => c[0])).toEqual([70, 70, 70, 70]);
  });

  it('falls back to seeded defaults when settings are absent/invalid', async () => {
    const allocate = jest.fn(async () => {
      throw m5Conflict();
    });
    const { svc, allocateAndPopulate, delay } = makeService({
      allocate,
      // retryMax omitted → no row → default 3
      backoff: 'invalid', // non-array → default [100,250,500]
    });
    await expect(svc.allocateForPick('r1')).rejects.toMatchObject({
      response: { code: 'PICK_ALLOCATION_RETRY_EXHAUSTED' },
    });
    expect(allocateAndPopulate).toHaveBeenCalledTimes(3);
    expect(delay.mock.calls.map((c) => c[0])).toEqual([100, 250]);
  });
});
