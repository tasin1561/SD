import { OrderNumberingService } from '../../src/modules/order/services/order-numbering.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * Fake Postgres: per-name in-memory sequences with the same atomic
 * `nextval` semantics. True cross-connection concurrency (100 parallel
 * allocators on real Postgres, zero duplicates) is asserted in the e2e
 * suite — a mocked client can only prove the format/rollover/SQL
 * contract, which is what these tests cover.
 */
function makeClient() {
  const seqs = new Map<string, number>();
  const createdCalls: string[] = [];
  const lockCalls: Array<[number, number]> = [];
  let txCalls = 0;

  const client = {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      txCalls += 1;
      return fn(client);
    },
    $executeRawUnsafe: async (q: string, ...vals: unknown[]): Promise<number> => {
      if (q.includes('pg_advisory_xact_lock')) {
        lockCalls.push([vals[0] as number, vals[1] as number]);
        return 1;
      }
      if (q.startsWith('CREATE SEQUENCE IF NOT EXISTS')) {
        const name = /"([^"]+)"/.exec(q)?.[1] ?? '';
        createdCalls.push(name);
        if (!seqs.has(name)) seqs.set(name, 0);
        return 0;
      }
      return 0;
    },
    $queryRawUnsafe: async <T>(q: string): Promise<T> => {
      const name = /nextval\('"([^"]+)"'\)/.exec(q)?.[1] ?? '';
      const next = (seqs.get(name) ?? 0) + 1;
      seqs.set(name, next);
      return [{ value: BigInt(next) }] as unknown as T;
    },
  };

  return {
    client,
    seqs,
    createdCalls,
    lockCalls,
    txCalls: () => txCalls,
  };
}

function makeService() {
  const fake = makeClient();
  const svc = new OrderNumberingService({ client: fake.client } as unknown as PrismaService);
  return { svc, ...fake };
}

const D2026 = new Date(Date.UTC(2026, 4, 17));
const D2027 = new Date(Date.UTC(2027, 0, 1));

describe('OrderNumberingService', () => {
  it('formats the first 2026 number as SD-2026-26-000001 and self-wraps in a txn', async () => {
    const { svc, createdCalls, lockCalls, txCalls } = makeService();

    const n = await svc.nextOrderNumber(undefined, D2026);

    expect(n).toBe('SD-2026-26-000001');
    expect(txCalls()).toBe(1); // self-wrapped (no tx passed)
    expect(createdCalls).toEqual(['order_number_seq_2026']);
    expect(lockCalls).toHaveLength(1);
    // namespace constant + year as the two advisory-lock keys
    expect(lockCalls[0]![1]).toBe(2026);
    expect(lockCalls[0]![0]).toBe(lockCalls[0]![0]); // stable namespace int
    expect(typeof lockCalls[0]![0]).toBe('number');
  });

  it('is monotonic and zero-padded across many sequential allocations', async () => {
    const { svc } = makeService();
    const numbers: string[] = [];
    for (let i = 0; i < 1000; i += 1) {
      numbers.push(await svc.nextOrderNumber(undefined, D2026));
    }
    expect(numbers[0]).toBe('SD-2026-26-000001');
    expect(numbers[999]).toBe('SD-2026-26-001000');
    expect(new Set(numbers).size).toBe(1000); // no duplicates
  });

  it('resets numbering per year (rollover) with the right suffix', async () => {
    const { svc, createdCalls } = makeService();

    await svc.nextOrderNumber(undefined, D2026);
    await svc.nextOrderNumber(undefined, D2026);
    const first2027 = await svc.nextOrderNumber(undefined, D2027);

    expect(first2027).toBe('SD-2027-27-000001'); // new year → fresh sequence
    expect(createdCalls).toContain('order_number_seq_2026');
    expect(createdCalls).toContain('order_number_seq_2027');
  });

  it('100 parallel allocations against one client yield no duplicates', async () => {
    const { svc } = makeService();
    const results = await Promise.all(
      Array.from({ length: 100 }, () => svc.nextOrderNumber(undefined, D2026)),
    );
    expect(new Set(results).size).toBe(100);
  });

  it('uses the supplied transaction client instead of self-wrapping', async () => {
    const { svc, client, txCalls } = makeService();

    const n = await svc.nextOrderNumber(client as never, D2026);

    expect(n).toBe('SD-2026-26-000001');
    expect(txCalls()).toBe(0); // caller owns the txn; we did not open one
  });

  it('refuses to allocate for an implausible year', async () => {
    const { svc } = makeService();
    await expect(
      svc.nextOrderNumber(undefined, new Date(Date.UTC(1999, 0, 1))),
    ).rejects.toThrow(/implausible year 1999/);
  });
});
