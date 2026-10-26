import {
  UAT_FIELDS,
  UatFieldsService,
} from '../../src/modules/uat-settings/services/uat-fields.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type Row = { key: string; valueBoolean: boolean | null };

function makeService(opts: { rows?: Row[]; throws?: boolean } = {}) {
  const findMany = jest.fn(async () => {
    if (opts.throws === true) throw new Error('database is down');
    return opts.rows ?? [];
  });
  const prisma = { client: { systemSetting: { findMany } } } as unknown as PrismaService;
  return { svc: new UatFieldsService(prisma), findMany };
}

const SHOWN: Row[] = [
  { key: UAT_FIELDS.orderDeliveryFee, valueBoolean: true },
  { key: UAT_FIELDS.orderDiscount, valueBoolean: true },
  { key: UAT_FIELDS.orderDeclaredValue, valueBoolean: true },
];

describe('UatFieldsService — it fails closed, and closed means HIDDEN', () => {
  /*
    The direction matters and is the opposite of most settings reads
    here. These fields are off BECAUSE the client asked for them to be
    off during UAT. So every way of not knowing — a missing row, a null
    column, a database that will not answer — has to resolve to what the
    client asked for, not to a field reappearing on a form mid-demo.
  */
  it.each([
    ['no rows at all', { rows: [] }],
    [
      'a row whose value is null',
      { rows: [{ key: UAT_FIELDS.orderDiscount, valueBoolean: null }] },
    ],
    ['a database that will not answer', { throws: true }],
  ])('%s hides every field', async (_name, opts) => {
    const { svc } = makeService(opts);
    expect(await svc.all()).toEqual({
      orderDeliveryFee: false,
      orderDiscount: false,
      orderDeclaredValue: false,
    });
  });

  it('shows a field only when its row says exactly true', async () => {
    const { svc } = makeService({ rows: SHOWN });
    expect(await svc.all()).toEqual({
      orderDeliveryFee: true,
      orderDiscount: true,
      orderDeclaredValue: true,
    });
  });

  it('turns fields on ONE at a time — they went off one at a time', async () => {
    const { svc } = makeService({
      rows: [
        { key: UAT_FIELDS.orderDiscount, valueBoolean: true },
        { key: UAT_FIELDS.orderDeliveryFee, valueBoolean: false },
      ],
    });
    const all = await svc.all();
    expect(all.orderDiscount).toBe(true);
    expect(all.orderDeliveryFee).toBe(false);
    // Absent entirely, which is not the same as false but reads the same.
    expect(all.orderDeclaredValue).toBe(false);
  });

  it('a row for some OTHER key cannot turn a field on', async () => {
    const { svc } = makeService({ rows: [{ key: 'uat.something_else', valueBoolean: true }] });
    expect(Object.values(await svc.all())).toEqual([false, false, false]);
  });
});

describe('UatFieldsService — the cache', () => {
  it('asks the database once for a burst of questions', async () => {
    // A CSV import asks per row. Four hundred rows must not be four
    // hundred queries for a value that changes when somebody clicks a
    // switch.
    const { svc, findMany } = makeService({ rows: SHOWN });
    for (let i = 0; i < 50; i++) await svc.isShown('orderDiscount');
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('a flipped switch is picked up without a restart', async () => {
    // The whole point is that the owner turns these on and off while
    // somebody is watching, so the cache has to expire on its own.
    jest.useFakeTimers();
    try {
      const { svc, findMany } = makeService({ rows: [] });
      expect(await svc.isShown('orderDiscount')).toBe(false);

      findMany.mockResolvedValue(SHOWN);
      jest.advanceTimersByTime(2_500);
      expect(await svc.isShown('orderDiscount')).toBe(true);
      expect(findMany).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not cache a failure as an answer', async () => {
    // A blip must not pin every field hidden until the process
    // restarts — the next question asks again.
    const { svc, findMany } = makeService({ throws: true });
    expect(await svc.isShown('orderDiscount')).toBe(false);
    findMany.mockImplementation(async () => SHOWN);
    jest.useFakeTimers();
    try {
      jest.advanceTimersByTime(2_500);
      expect(await svc.isShown('orderDiscount')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('UatFieldsService — the keys are the seeded ones', () => {
  it('names the three settings the seed creates', () => {
    // A typo here is a field that can never be turned on, and nothing
    // would fail — `all()` would simply keep answering false.
    expect(Object.values(UAT_FIELDS).sort()).toEqual([
      'uat.order_declared_value_field',
      'uat.order_delivery_fee_field',
      'uat.order_discount_field',
    ]);
  });
});
