import { CourierWriteGuardService } from '../../src/modules/courier-shared/services/courier-write-guard.service';
import { DelhiveryWriteGuardService } from '../../src/modules/courier-delhivery/services/delhivery-write-guard.service';
import {
  DelhiveryRateLimitError,
  DelhiveryRateLimitService,
} from '../../src/modules/courier-delhivery/services/delhivery-rate-limit.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { RedisService } from '../../src/infrastructure/redis/redis.service';

type AnyArgs = Record<string, unknown>;

/* ── the write guard ─────────────────────────────────────────────────
 * Skydrop has no Delhivery sandbox. These tests pin the property that
 * matters: nothing with a physical-world effect happens unless somebody
 * deliberately turned it on.
 */
function makeGuard(opts: { setting?: AnyArgs | null; baseUrl?: string } = {}) {
  // Key-aware: the write FLAG and the base URL are separate settings,
  // and the whole point of the target check is that they can disagree.
  const findUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async (args) => {
    const key = (args as { where?: { key?: string } }).where?.key;
    if (key === 'courier.delhivery_api_base_url') {
      return opts.baseUrl === undefined ? null : { valueString: opts.baseUrl };
    }
    return opts.setting === undefined ? { valueBoolean: true } : opts.setting;
  });
  const prisma = {
    client: { systemSetting: { findUnique } },
  } as unknown as PrismaService;
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a1');
  const audit = { log: auditLog } as unknown as AuditLogService;
  // The guard is now one generic implementation keyed by courier code;
  // this class is the Delhivery-shaped face of it. Constructing it
  // through the real generic service keeps these tests testing the
  // BEHAVIOUR rather than a mock of it.
  const generic = new CourierWriteGuardService(prisma, audit);
  return { svc: new DelhiveryWriteGuardService(generic), auditLog, findUnique };
}

describe('DelhiveryWriteGuardService', () => {
  it('permits a write when live writes are explicitly enabled', async () => {
    const { svc, auditLog } = makeGuard({ setting: { valueBoolean: true } });
    await expect(svc.assertWritable('shipment.create')).resolves.toBeUndefined();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('BLOCKS a write when the setting is off', async () => {
    const { svc } = makeGuard({ setting: { valueBoolean: false } });
    await expect(svc.assertWritable('shipment.create')).rejects.toMatchObject({
      response: { code: 'DELHIVERY_LIVE_WRITES_DISABLED' },
    });
  });

  it('FAILS CLOSED when the setting row does not exist', async () => {
    // A missing setting must never read as permission. This is the case
    // that would otherwise bite on a fresh environment.
    const { svc } = makeGuard({ setting: null });
    await expect(svc.assertWritable('pickup.request')).rejects.toMatchObject({
      response: { code: 'DELHIVERY_LIVE_WRITES_DISABLED' },
    });
  });

  it('FAILS CLOSED on a null boolean rather than coercing it', async () => {
    const { svc } = makeGuard({ setting: { valueBoolean: null } });
    await expect(svc.assertWritable('ndr.action')).rejects.toBeDefined();
  });

  it('audits every blocked attempt at HIGH — a worker looping on a blocked write must be visible', async () => {
    const { svc, auditLog } = makeGuard({ setting: { valueBoolean: false } });
    await expect(svc.assertWritable('shipment.cancel', { awb: '123' })).rejects.toBeDefined();
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'courier.delhivery.live_write_blocked',
        severity: 'HIGH',
        metadata: expect.objectContaining({ operation: 'shipment.cancel', awb: '123' }),
      }),
    );
  });

  it.each([
    'shipment.create',
    'shipment.edit',
    'shipment.cancel',
    'pickup.request',
    'ndr.action',
    'warehouse.write',
    'ewaybill.update',
    'waybill.fetch',
  ] as const)('gates %s', async (op) => {
    const { svc } = makeGuard({ setting: { valueBoolean: false } });
    await expect(svc.assertWritable(op)).rejects.toBeDefined();
  });
});

/* ── the rate limiter ────────────────────────────────────────────────
 * Delhivery's WAF answers 403 and blocks the whole egress IP, so going
 * over budget in a background job would take live traffic down too.
 */
function makeLimiter(opts: { used?: number; redisThrows?: boolean } = {}) {
  let counter = opts.used ?? 0;
  const incr = jest.fn(async () => {
    if (opts.redisThrows) throw new Error('redis down');
    counter += 1;
    return counter;
  });
  const expire = jest.fn(async () => 1);
  const get = jest.fn(async () => String(counter));
  const redis = {
    client: { incr, expire, get },
  } as unknown as RedisService;
  return { svc: new DelhiveryRateLimitService(redis), incr, expire };
}

/* ── where a live write would actually go ─────────────────────────────
 * The write flag became ambiguous the moment a simulator existed:
 * exercising the real code path REQUIRES turning it on, and it is then
 * one edit to the base URL away from a worker manifesting real parcels
 * that nobody decided to create. These pin that permission granted for
 * a simulator cannot silently become permission for production.
 */
describe('DelhiveryWriteGuardService — write target', () => {
  it.each([
    ['http://localhost:4010', 'localhost'],
    ['http://127.0.0.1:4010', 'loopback'],
    ['http://192.168.1.20:4010', 'private LAN'],
    ['http://10.2.3.4:4010', 'private 10/8'],
    ['http://172.16.5.6:4010', 'private 172.16/12'],
    ['http://delhivery-sim:4010', 'the simulator by name'],
  ])('treats %s as a simulator (%s)', async (baseUrl) => {
    const { svc } = makeGuard({ setting: { valueBoolean: true }, baseUrl });
    await expect(svc.writeTarget()).resolves.toMatchObject({ simulator: true });
  });

  it.each([
    ['https://track.delhivery.com', 'the real API'],
    ['https://staging.delhivery.com', 'anything on their domain'],
    ['http://203.0.113.9:4010', 'a simulator someone exposed publicly'],
  ])('treats %s as PRODUCTION (%s)', async (baseUrl) => {
    const { svc } = makeGuard({ setting: { valueBoolean: true }, baseUrl });
    await expect(svc.writeTarget()).resolves.toMatchObject({ simulator: false });
  });

  it('treats an unparseable base URL as production, not as safe', async () => {
    const { svc } = makeGuard({ setting: { valueBoolean: true }, baseUrl: 'not a url' });
    await expect(svc.writeTarget()).resolves.toMatchObject({ simulator: false });
  });

  it('an empty base URL is stub mode — the adapter never reaches a network', async () => {
    const { svc } = makeGuard({ setting: { valueBoolean: true }, baseUrl: '' });
    await expect(svc.writeTarget()).resolves.toMatchObject({ simulator: true });
  });

  it('a write to a SIMULATOR is silent — that is the working mode', async () => {
    const { svc, auditLog } = makeGuard({
      setting: { valueBoolean: true },
      baseUrl: 'http://localhost:4010',
    });
    await expect(svc.assertWritable('shipment.create')).resolves.toBeUndefined();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('a write to PRODUCTION is allowed but AUDITED at HIGH with the host', async () => {
    // Allowed, because a controlled first-parcel test is exactly this.
    // Audited, so "when did we start manifesting real parcels, and
    // against what" is answerable from the log rather than from memory.
    const { svc, auditLog } = makeGuard({
      setting: { valueBoolean: true },
      baseUrl: 'https://track.delhivery.com',
    });
    await expect(svc.assertWritable('shipment.create')).resolves.toBeUndefined();
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'courier.delhivery.live_write_to_production',
        severity: 'HIGH',
        metadata: expect.objectContaining({ host: 'track.delhivery.com' }),
      }),
    );
  });

  it('the flag being OFF still blocks, whatever the target', async () => {
    const { svc } = makeGuard({
      setting: { valueBoolean: false },
      baseUrl: 'http://localhost:4010',
    });
    await expect(svc.assertWritable('shipment.create')).rejects.toMatchObject({
      response: { code: 'DELHIVERY_LIVE_WRITES_DISABLED' },
    });
  });
});

describe('DelhiveryRateLimitService', () => {
  it('budgets to 80% of the documented limit, leaving WAF headroom', () => {
    const { svc } = makeLimiter();
    expect(svc.budgetFor('tracking')).toBe(600); // 750 documented
    expect(svc.budgetFor('create')).toBe(16_000); // 20 000 documented
    expect(svc.budgetFor('ewaybill')).toBe(200); // 250 documented
  });

  it('treats bulk waybill as the tiny budget it really is', () => {
    const { svc } = makeLimiter();
    // FIVE requests per five minutes. This is precisely why waybills have
    // to be pooled in advance instead of fetched per shipment.
    expect(svc.budgetFor('waybill_bulk')).toBe(4);
  });

  it('applies a conservative fallback where Delhivery documents no limit', () => {
    const { svc } = makeLimiter();
    // "NA" is not "unlimited".
    expect(svc.budgetFor('ndr')).toBe(480);
  });

  it('allows a call inside budget and sets the window TTL once', async () => {
    const { svc, expire } = makeLimiter({ used: 0 });
    await expect(svc.consume('tracking')).resolves.toBeUndefined();
    expect(expire).toHaveBeenCalledTimes(1); // only on the first increment
  });

  it('refuses locally once the window is exhausted, with a retry hint', async () => {
    const { svc } = makeLimiter({ used: 4 }); // next incr → 5 > budget 4
    await expect(svc.consume('waybill_bulk')).rejects.toBeInstanceOf(DelhiveryRateLimitError);
  });

  it('FAILS OPEN when Redis is down — a cache outage must not stop shipping', async () => {
    const { svc } = makeLimiter({ redisThrows: true });
    await expect(svc.consume('create')).resolves.toBeUndefined();
  });
});
