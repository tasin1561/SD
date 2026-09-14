import { ResellerStockMode } from '@skydrop/db';
import { COMMITTING_STORE_STATUSES } from '../../src/modules/reseller-catalogue/services/reseller-catalogue.service';
import { InsufficientStockError } from '../../src/modules/inventory-stock/services/stock-reservation.service';
import {
  GATE_COMMITTING_STORE_STATUSES,
  ResellerStockGateService,
} from '../../src/modules/reseller-order-gate/services/reseller-stock-gate.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type AnyArgs = Record<string, unknown>;

/**
 * RS-5 — the gate's guard, which M5 `reserve()` runs inside each
 * confirmation reservation's own transaction.
 */
function makeGate(opts: {
  setAsides?: Array<{ storeId: string; variantId: string; setAsideQty: number }>;
  consumed?: Map<string, Map<string, number>>;
  available?: number;
}) {
  const calls: string[] = [];
  const tx = {
    $executeRaw: jest.fn(async () => {
      calls.push('lock');
      return 1;
    }),
    resellerStoreVariant: {
      findMany: jest.fn(async (_a: AnyArgs) => {
        calls.push('commitments');
        return opts.setAsides ?? [];
      }),
    },
  };
  const stock = {
    activeReservedByResellerStore: jest.fn(async () => opts.consumed ?? new Map()),
    getSellableStockLive: jest.fn(async (_s: string, ids: string[]) => {
      calls.push('stock');
      return new Map(ids.map((id) => [id, { onHand: 99, available: opts.available ?? 0 }]));
    }),
  };
  const gate = new ResellerStockGateService(
    { client: tx } as unknown as PrismaService,
    stock as never,
    {} as never,
  );
  return { gate, tx, stock, calls };
}

describe('ResellerStockGateService.guardFor (RS-5)', () => {
  it('counts the same store statuses as the catalogue (the list is restated, not imported)', () => {
    expect([...GATE_COMMITTING_STORE_STATUSES].sort()).toEqual(
      [...COMMITTING_STORE_STATUSES].sort(),
    );
  });

  it('takes the RESELLER_SET_ASIDE lock BEFORE reading anything', async () => {
    const { gate, tx, calls } = makeGate({
      setAsides: [{ storeId: 'store-a', variantId: 'v1', setAsideQty: 2 }],
      available: 10,
    });
    await gate.guardFor({ sellerId: 's1', variantId: 'v1', qty: 1, resellerStoreId: null })(
      tx as never,
    );
    expect(calls[0]).toBe('lock');
  });

  it('a CHANNEL line of a variant no store set aside is untouched — no stock read at all', async () => {
    const { gate, tx, stock } = makeGate({ setAsides: [], available: 0 });
    await expect(
      gate.guardFor({ sellerId: 's1', variantId: 'v1', qty: 50, resellerStoreId: null })(
        tx as never,
      ),
    ).resolves.toBeUndefined();
    expect(stock.getSellableStockLive).not.toHaveBeenCalled();
  });

  it('a CHANNEL line may not eat a store’s unused set-aside — refused as InsufficientStockError', async () => {
    const { gate, tx } = makeGate({
      setAsides: [{ storeId: 'store-a', variantId: 'v1', setAsideQty: 6 }],
      available: 10,
    });
    const guard = gate.guardFor({ sellerId: 's1', variantId: 'v1', qty: 5, resellerStoreId: null });
    await expect(guard(tx as never)).rejects.toBeInstanceOf(InsufficientStockError);
    const ok = gate.guardFor({ sellerId: 's1', variantId: 'v1', qty: 4, resellerStoreId: null });
    await expect(ok(tx as never)).resolves.toBeUndefined();
  });

  it('a SET_ASIDE store uses its own unused set-aside, after what its orders already hold', async () => {
    const { gate, tx } = makeGate({
      setAsides: [{ storeId: 'store-a', variantId: 'v1', setAsideQty: 5 }],
      consumed: new Map([['store-a', new Map([['v1', 3]])]]),
      available: 20,
    });
    await expect(
      gate.guardFor({ sellerId: 's1', variantId: 'v1', qty: 3, resellerStoreId: 'store-a' })(
        tx as never,
      ),
    ).rejects.toBeInstanceOf(InsufficientStockError);
    await expect(
      gate.guardFor({ sellerId: 's1', variantId: 'v1', qty: 2, resellerStoreId: 'store-a' })(
        tx as never,
      ),
    ).resolves.toBeUndefined();
  });

  it('reads the commitments of LIVE reseller stores only, SET_ASIDE rows only', async () => {
    const { gate, tx } = makeGate({ setAsides: [] });
    await gate.guardFor({ sellerId: 's1', variantId: 'v1', qty: 1, resellerStoreId: null })(
      tx as never,
    );
    const where = (tx.resellerStoreVariant.findMany.mock.calls[0]![0] as AnyArgs)[
      'where'
    ] as AnyArgs;
    expect(where['stockMode']).toBe(ResellerStockMode.SET_ASIDE);
    expect(where['sellerId']).toBe('s1');
    const store = where['store'] as AnyArgs;
    expect(store['kind']).toBe('RESELLER');
    expect(store['deletedAt']).toBeNull();
  });
});
