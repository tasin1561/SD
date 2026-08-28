import { ServiceabilityCacheService } from '../../src/modules/courier-serviceability/services/serviceability-cache.service';
import type { RedisService } from '../../src/infrastructure/redis/redis.service';

function makeSut(opts: { hit?: string | null; getThrows?: boolean } = {}) {
  const store = new Map<string, string>();
  const get = jest.fn(async (k: string) => {
    if (opts.getThrows === true) throw new Error('redis down');
    return opts.hit !== undefined ? opts.hit : (store.get(k) ?? null);
  });
  const set = jest.fn(async (k: string, v: string) => {
    store.set(k, v);
    return 'OK';
  });
  const redis = { client: { get, set } } as unknown as RedisService;
  return { svc: new ServiceabilityCacheService(redis), get, set, store };
}

describe('ServiceabilityCacheService', () => {
  it('asks the courier once, then answers from memory', async () => {
    // The whole reason this exists: the underlying check is a live call
    // against an account whose WAF blocks our entire egress IP when a
    // budget runs out. One per order create is not a trade worth making
    // for an answer that changes maybe twice a year.
    const sut = makeSut();
    const compute = jest.fn(async () => ({ ok: true, reason: null }));

    const first = await sut.svc.get('560001', 'COD', compute);
    const second = await sut.svc.get('560001', 'COD', compute);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(first?.fresh).toBe(true);
    expect(second?.fresh).toBe(false);
    expect(second?.serviceable).toBe(true);
  });

  it('keys on payment mode — a pin can take prepaid and refuse COD', async () => {
    const sut = makeSut();
    const compute = jest.fn(async () => ({ ok: true, reason: null }));
    await sut.svc.get('560001', 'COD', compute);
    await sut.svc.get('560001', 'PREPAID', compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('remembers a refusal, not just an acceptance', async () => {
    const sut = makeSut();
    const compute = jest.fn(async () => ({ ok: false, reason: 'Not serviceable' }));
    const r = await sut.svc.get('999999', 'COD', compute);
    expect(r).toEqual({ serviceable: false, reason: 'Not serviceable', fresh: true });
  });

  it('returns null when the courier will not answer — unknown is not unserviceable', async () => {
    // Treating an outage as a refusal would stop the business over a
    // problem somewhere else entirely.
    const sut = makeSut();
    const compute = jest.fn(async () => {
      throw new Error('Delhivery 503');
    });
    expect(await sut.svc.get('560001', 'COD', compute)).toBeNull();
  });

  it('does not hammer a failing courier — the failure is cached briefly', async () => {
    const sut = makeSut();
    const compute = jest.fn(async () => {
      throw new Error('Delhivery 503');
    });
    await sut.svc.get('560001', 'COD', compute);
    // Second call reads the short-lived entry rather than trying again.
    const second = await sut.svc.get('560001', 'COD', compute);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(second?.fresh).toBe(false);
  });

  it('a cache that cannot be read still lets the order through', async () => {
    const sut = makeSut({ getThrows: true });
    const compute = jest.fn(async () => ({ ok: true, reason: null }));
    const r = await sut.svc.get('560001', 'COD', compute);
    expect(r?.serviceable).toBe(true);
  });
});
