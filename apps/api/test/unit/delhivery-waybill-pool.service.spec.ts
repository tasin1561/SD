import { CourierWaybillStatus } from '@skydrop/db';
import { DelhiveryWaybillPoolService } from '../../src/modules/courier-delhivery/services/delhivery-waybill-pool.service';
import { DelhiveryWarehouseService } from '../../src/modules/courier-delhivery/services/delhivery-warehouse.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { DelhiveryHttpService } from '../../src/modules/courier-delhivery/services/delhivery-http.service';
import type { DelhiveryWriteGuardService } from '../../src/modules/courier-delhivery/services/delhivery-write-guard.service';

type AnyArgs = Record<string, unknown>;

function makePool(
  opts: {
    claimable?: Array<{ id: string; awb_number: string }>;
    available?: number;
    stub?: boolean;
    apiResponse?: string | string[];
    writesBlocked?: boolean;
    settings?: Record<string, number>;
  } = {},
) {
  const queryRaw = jest.fn(async () => opts.claimable ?? []);
  const count = jest.fn(async () => opts.available ?? 0);
  const update = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({}));
  const updateMany = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({ count: 1 }));
  const createMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(async (args) => ({
    count: (args['data'] as unknown[]).length,
  }));
  const groupBy = jest.fn(async () => []);
  const settingFindUnique = jest.fn(async (args: AnyArgs) => {
    const key = (args['where'] as AnyArgs)['key'] as string;
    const v = opts.settings?.[key];
    return v === undefined ? null : { valueInt: v };
  });

  const prisma = {
    client: {
      $queryRaw: queryRaw,
      courierWaybill: { count, update, updateMany, createMany, groupBy },
      systemSetting: { findUnique: settingFindUnique },
    },
  } as unknown as PrismaService;

  const request = jest.fn<Promise<unknown>, [AnyArgs]>(async () => opts.apiResponse ?? '');
  const http = {
    isStubMode: jest.fn(async () => opts.stub ?? false),
    request,
  } as unknown as DelhiveryHttpService;

  const assertWritable = jest.fn(async () => {
    if (opts.writesBlocked) throw new Error('DELHIVERY_LIVE_WRITES_DISABLED');
  });
  const writeGuard = { assertWritable } as unknown as DelhiveryWriteGuardService;

  return {
    svc: new DelhiveryWaybillPoolService(prisma, http, writeGuard),
    update,
    updateMany,
    createMany,
    request,
    assertWritable,
  };
}

describe('DelhiveryWaybillPoolService — parsing the real response', () => {
  it('parses a single bare JSON string (verified: "38061110478262")', () => {
    const { svc } = makePool();
    expect(svc.parseWaybillResponse('38061110478262')).toEqual(['38061110478262']);
  });

  it('parses the comma-separated multi form — NOT an array, as one might assume', () => {
    // Verified against production: count=3 returned
    // "38061110478273,38061110478284,38061110478295".
    const { svc } = makePool();
    expect(svc.parseWaybillResponse('38061110478273,38061110478284,38061110478295')).toEqual([
      '38061110478273',
      '38061110478284',
      '38061110478295',
    ]);
  });

  it('tolerates an array too, in case the shape changes under us', () => {
    const { svc } = makePool();
    expect(svc.parseWaybillResponse(['111', '222'])).toEqual(['111', '222']);
  });

  it('strips stray quotes and blanks rather than storing junk as an AWB', () => {
    const { svc } = makePool();
    expect(svc.parseWaybillResponse('"111", ,222 ')).toEqual(['111', '222']);
  });
});

describe('DelhiveryWaybillPoolService.claim', () => {
  it('hands out a settled waybill and marks it ASSIGNED', async () => {
    const sut = makePool({ claimable: [{ id: 'w1', awb_number: '38061110478262' }] });
    await expect(sut.svc.claim('ship-1')).resolves.toBe('38061110478262');
    expect(sut.update.mock.calls[0]![0]).toMatchObject({
      where: { id: 'w1' },
      data: expect.objectContaining({
        status: CourierWaybillStatus.ASSIGNED,
        shipmentId: 'ship-1',
      }),
    });
  });

  it('throws WAYBILL_POOL_EMPTY rather than fetching inline', async () => {
    // Inline fetching would be worse than failing: the budget is five
    // requests per five minutes, so one dry manifest would stall the queue.
    const sut = makePool({ claimable: [] });
    await expect(sut.svc.claim('ship-1')).rejects.toMatchObject({
      response: { code: 'WAYBILL_POOL_EMPTY' },
    });
    expect(sut.request).not.toHaveBeenCalled();
  });
});

describe('DelhiveryWaybillPoolService.refillIfNeeded', () => {
  it('does nothing while the pool is above the low-water mark', async () => {
    const sut = makePool({
      available: 500,
      settings: { 'courier.delhivery_waybill_pool_low_water': 200 },
    });
    await expect(sut.svc.refillIfNeeded()).resolves.toEqual({
      fetched: 0,
      poolAfter: 500,
    });
    expect(sut.request).not.toHaveBeenCalled();
  });

  it('fetches and stores when the pool is low', async () => {
    const sut = makePool({
      available: 10,
      apiResponse: '111,222,333',
      settings: {
        'courier.delhivery_waybill_pool_low_water': 200,
        'courier.delhivery_waybill_pool_refill_batch': 3,
      },
    });
    const r = await sut.svc.refillIfNeeded();
    expect(r.fetched).toBe(3);
    expect(String((sut.request.mock.calls[0]![0] as AnyArgs)['path'])).toContain('count=3');
  });

  it('sets usableAfter in the FUTURE — a fresh waybill must settle first', async () => {
    // Delhivery mints numbers in batches of 25 behind the scenes and warns
    // that using one immediately "may occasionally result in errors".
    const before = Date.now();
    const sut = makePool({
      available: 0,
      apiResponse: '111',
      settings: {
        'courier.delhivery_waybill_pool_low_water': 10,
        'courier.delhivery_waybill_settle_seconds': 120,
      },
    });
    await sut.svc.refillIfNeeded();
    const rows = (sut.createMany.mock.calls[0]![0] as AnyArgs)['data'] as Array<{
      usableAfter: Date;
    }>;
    expect(rows[0]!.usableAfter.getTime()).toBeGreaterThanOrEqual(before + 119_000);
  });

  it('is gated by the write guard — fetching consumes the real AWB allocation', async () => {
    const sut = makePool({
      available: 0,
      writesBlocked: true,
      settings: { 'courier.delhivery_waybill_pool_low_water': 10 },
    });
    await expect(sut.svc.refillIfNeeded()).rejects.toThrow('DELHIVERY_LIVE_WRITES_DISABLED');
    expect(sut.request).not.toHaveBeenCalled();
  });

  it('stub mode mints local numbers so the manifest path works with no network', async () => {
    const sut = makePool({
      available: 0,
      stub: true,
      settings: { 'courier.delhivery_waybill_pool_low_water': 10 },
    });
    const r = await sut.svc.refillIfNeeded();
    expect(r.fetched).toBeGreaterThan(0);
    expect(sut.request).not.toHaveBeenCalled();
    expect(sut.assertWritable).not.toHaveBeenCalled();
  });

  it('skips duplicates rather than losing a whole batch to one repeat', async () => {
    const sut = makePool({
      available: 0,
      apiResponse: '111,222',
      settings: { 'courier.delhivery_waybill_pool_low_water': 10 },
    });
    await sut.svc.refillIfNeeded();
    expect(sut.createMany.mock.calls[0]![0]).toMatchObject({ skipDuplicates: true });
  });
});

describe('DelhiveryWaybillPoolService.void', () => {
  it('retires a rejected AWB and never returns it to the pool', async () => {
    // Delhivery may have partially registered it; re-issuing a number that
    // already means something is worse than wasting one.
    const sut = makePool();
    await sut.svc.void('38061110478262', 'rejected at manifest');
    expect(sut.updateMany.mock.calls[0]![0]).toMatchObject({
      data: expect.objectContaining({ status: CourierWaybillStatus.VOID }),
    });
  });
});

describe('DelhiveryWarehouseService — the name is load-bearing', () => {
  function makeWh(stub = true) {
    const http = {
      isStubMode: jest.fn(async () => stub),
      request: jest.fn(async () => ({ success: true })),
    } as unknown as DelhiveryHttpService;
    const writeGuard = {
      assertWritable: jest.fn(async () => undefined),
    } as unknown as DelhiveryWriteGuardService;
    return new DelhiveryWarehouseService(http, writeGuard);
  }

  it('rejects a name with surrounding whitespace before it can reach Delhivery', async () => {
    // "Skydrop " and "Skydrop" are different pickup locations to
    // Delhivery, and the mismatch only shows up as a rejected manifest.
    await expect(
      makeWh().register({
        name: 'Skydrop ',
        phone: '9999999999',
        pin: '560001',
        returnAddress: 'addr',
      }),
    ).rejects.toThrow(/whitespace/);
  });

  it('rejects an empty name', async () => {
    await expect(
      makeWh().register({
        name: '',
        phone: '9999999999',
        pin: '560001',
        returnAddress: 'addr',
      }),
    ).rejects.toThrow(/cannot be empty/);
  });

  it('accepts a clean name', async () => {
    await expect(
      makeWh().register({
        name: 'Skydrop',
        phone: '9999999999',
        pin: '560001',
        returnAddress: 'addr',
      }),
    ).resolves.toMatchObject({ success: true, name: 'Skydrop' });
  });
});
