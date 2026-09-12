import { InboundFreightMode, InboundFreightStatus, Prisma } from '@skydrop/db';
import { InboundFreightService } from '../../src/modules/inbound-freight/services/inbound-freight.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * Two forwarder payments (or a payment and an attribution) on ONE bill,
 * at the same moment.
 *
 * Each posts its entry and then re-sums every payment on the bill into
 * `our_cost_inr`. Under READ COMMITTED each transaction sees only its OWN
 * uncommitted entry, so without a lock the second write of the total drops
 * the first payment — and a linked payment is excluded from operating
 * expenses, so it vanished from the P&L entirely.
 *
 * A mocked Prisma runs one call after another and cannot show that. This
 * fake keeps what a transaction wrote invisible to others until it
 * commits, yields between steps so the two genuinely interleave, and
 * implements the advisory lock as a real mutex held to commit.
 */

type Args = Record<string, unknown>;
const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

interface Entry {
  id: string;
  chargeId: string | null;
  currency: 'INR';
  signedAmount: Prisma.Decimal;
  occurredAt: Date;
}

interface TxState {
  pending: Entry[];
  links: Array<{ id: string; chargeId: string }>;
}

function world(opts: { lock: boolean } = { lock: true }) {
  const committed: Entry[] = [];
  let ourCost: Prisma.Decimal | null = null;
  const lockTails = new Map<string, Promise<void>>();
  let seq = 0;

  const chargeRow = (cost: Prisma.Decimal | null): Args => ({
    id: 'fc-1',
    sellerId: 'seller-1',
    consignmentId: 'cn-1',
    goodsReceiptId: 'gr-1',
    amountInr: D('4500.00'),
    ourCostInr: cost,
    mode: InboundFreightMode.PAY_LATER,
    serviceChargePercent: null,
    serviceChargeInr: null,
    totalInr: D('4500.00'),
    totalUnits: 10,
    unitsSettled: 0,
    amountSettledInr: D('0'),
    status: InboundFreightStatus.PENDING,
    settledAt: null,
    walletEntryId: null,
    note: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    consignment: { consignmentNumber: 'CN-1' },
    goodsReceipt: { receiptNumber: 'GR-1' },
    seller: { companyName: 'Menev Store' },
  });

  async function $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    const state: TxState = { pending: [], links: [] };
    let costWrite: Prisma.Decimal | undefined;
    const releases: Array<() => void> = [];
    const tx = {
      __state: state,
      $executeRaw: async (_s: TemplateStringsArray, ns: number, key: number): Promise<number> => {
        if (!opts.lock) return 1;
        const k = `${ns}:${key}`;
        const prev = lockTails.get(k) ?? Promise.resolve();
        let release: () => void = () => undefined;
        const mine = new Promise<void>((r) => {
          release = r;
        });
        lockTails.set(
          k,
          prev.then(() => mine),
        );
        releases.push(release);
        await prev;
        return 1;
      },
      bankEntry: {
        findMany: async (a: Args) => {
          const chargeId = (a['where'] as Args)['inboundFreightChargeId'];
          const linked = new Map(state.links.map((l) => [l.id, l.chargeId]));
          return [...committed, ...state.pending]
            .map((e) => ({ ...e, chargeId: linked.get(e.id) ?? e.chargeId }))
            .filter((e) => e.chargeId === chargeId);
        },
      },
      inboundFreightCharge: {
        update: async (a: Args) => {
          costWrite = (a['data'] as Args)['ourCostInr'] as Prisma.Decimal;
          await tick();
          return chargeRow(costWrite);
        },
      },
    };
    try {
      const out = await fn(tx);
      // COMMIT: only now does anybody else see what this transaction wrote.
      committed.push(...state.pending);
      for (const l of state.links) {
        const e = committed.find((x) => x.id === l.id);
        if (e !== undefined) e.chargeId = l.chargeId;
      }
      if (costWrite !== undefined) ourCost = costWrite;
      return out;
    } finally {
      for (const r of releases) r();
    }
  }

  const client = {
    $transaction,
    platformBankAccount: {
      findFirst: async () => ({ id: 'ba-1', currency: 'INR', label: 'HDFC' }),
    },
    inboundFreightCharge: {
      findUnique: async () => ({
        id: 'fc-1',
        ourCostInr: ourCost,
        consignment: { consignmentNumber: 'CN-1' },
      }),
    },
    expenseCategory: { findUnique: async () => ({ id: 'cat-freight' }) },
    bankEntry: {
      findUnique: async (a: Args) => {
        const e = committed.find((x) => x.id === (a['where'] as Args)['id']);
        return e === undefined
          ? null
          : {
              id: e.id,
              type: 'EXPENSE',
              currency: e.currency,
              signedAmount: e.signedAmount,
              inboundFreightChargeId: e.chargeId,
            };
      },
    },
  };

  const bank = {
    post: async (input: Args, tx: { __state: TxState }) => {
      const id = `be-${(seq += 1)}`;
      tx.__state.pending.push({
        id,
        chargeId: (input['inboundFreightChargeId'] as string | undefined) ?? null,
        currency: 'INR',
        signedAmount: new Prisma.Decimal(input['signedAmount'] as Prisma.Decimal),
        occurredAt: input['occurredAt'] as Date,
      });
      await tick();
      return { id };
    },
    attributeToFreightCharge: async (id: string, chargeId: string, tx: { __state: TxState }) => {
      tx.__state.links.push({ id, chargeId });
      await tick();
      return { claimed: true };
    },
  };

  const svc = new InboundFreightService(
    { client } as unknown as PrismaService,
    { log: jest.fn(async () => null) } as never,
    {} as never,
    {} as never,
    {} as never,
    bank as never,
  );

  return {
    svc,
    ourCost: (): string | undefined => ourCost?.toFixed(2),
    /** An expense recorded on /expenses before anybody linked it. */
    seedExpense(amount: string): string {
      const id = `be-${(seq += 1)}`;
      committed.push({
        id,
        chargeId: null,
        currency: 'INR',
        signedAmount: D(amount).negated(),
        occurredAt: new Date('2026-09-02T00:00:00Z'),
      });
      return id;
    },
  };
}

const pay = (amountPaid: string) => ({
  bankAccountId: 'ba-1',
  amountPaid,
  occurredAt: new Date('2026-09-01T00:00:00Z'),
});

describe('forwarder payments on one bill, at the same moment', () => {
  it('two payments at once: our cost is BOTH — ₹30,000 + ₹20,000 = ₹50,000', async () => {
    const w = world();
    await Promise.all([
      w.svc.recordForwarderPayment('st-1', 'fc-1', pay('30000.00')),
      w.svc.recordForwarderPayment('st-2', 'fc-1', pay('20000.00')),
    ]);
    expect(w.ourCost()).toBe('50000.00');
  });

  it('a payment racing an attribution: neither falls off the total', async () => {
    const w = world();
    const expense = w.seedExpense('5000.00');
    await Promise.all([
      w.svc.recordForwarderPayment('st-1', 'fc-1', pay('30000.00')),
      w.svc.attributeExistingPayment('st-2', 'fc-1', { bankEntryId: expense }),
    ]);
    expect(w.ourCost()).toBe('35000.00');
  });

  it('the fake is honest: without the lock the same race loses a payment', async () => {
    // Proves the two cases above pass BECAUSE of the lock, not because
    // this fake happens to run one transaction after the other.
    const w = world({ lock: false });
    await Promise.all([
      w.svc.recordForwarderPayment('st-1', 'fc-1', pay('30000.00')),
      w.svc.recordForwarderPayment('st-2', 'fc-1', pay('20000.00')),
    ]);
    expect(w.ourCost()).not.toBe('50000.00');
  });
});
