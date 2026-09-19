import {
  BankEntryType,
  BankOwnerKind,
  Currency,
  OrderStatus,
  PaymentMode,
  Prisma,
  ResellerCreditTrigger,
  ResellerMoneyParty,
} from '@skydrop/db';
import {
  AdvisoryLock,
  ATTRIBUTION_RECONCILE_KEY,
  accountReconcileKey,
  advisoryKey,
} from '../../src/common/db/advisory-lock';
import { CourierSettlementService } from '../../src/modules/courier-settlement/services/courier-settlement.service';
import { CodCreditService } from '../../src/modules/seller-wallet-accrual/services/cod-credit.service';
import { BankLedgerService } from '../../src/modules/treasury/services/bank-ledger.service';
import { BankTransferService } from '../../src/modules/treasury/services/bank-transfer.service';
import { SellerCashAttributionService } from '../../src/modules/treasury/services/seller-cash-attribution.service';
import { StaffWalletTransferService } from '../../src/modules/admin-wallet-transfer/services/staff-wallet-transfer.service';
import { SellerManagedStoreWalletService } from '../../src/modules/reseller-store-wallet/services/seller-managed-store-wallet.service';
import { StoreTopupService } from '../../src/modules/reseller-store-wallet/services/store-topup.service';
import { StoreWalletService } from '../../src/modules/reseller-store-wallet/services/store-wallet.service';
import { StoreWithdrawalService } from '../../src/modules/reseller-store-wallet/services/store-withdrawal.service';
import { WithdrawalRequestService } from '../../src/modules/seller-wallet-withdrawal/services/withdrawal-request.service';
import { ResellerOrderMoneyService } from '../../src/modules/reseller-order-money/services/reseller-order-money.service';

/** RS-6 phase 3c — the channel-order scenarios never meet a reseller order. */
const NO_RESELLER_MONEY = {
  isResellerOrder: async () => false,
  head: async () => null,
} as never;

/**
 * TRE-4 / TRE-8, end to end in memory: after every payout, the cash the
 * bank book holds for a seller equals what their wallet says they are owed
 * — max(0, balance) — and the account moves by exactly what landed.
 *
 * The REAL CodCreditService and SellerCashAttributionService run here, over
 * an in-memory wallet and bank book; only Prisma is faked. This is the
 * test that caught the tax on a settled COD never becoming ours: the
 * credit ran before the seller's cash was posted, so the attribution found
 * nothing to take and the seller was held the gross.
 */

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
const ZERO = D('0');
const CREDITS = new Set([
  'COD_COLLECTION',
  'COD_DEDUCTION_REFUND',
  'TOPUP',
  'ORDER_CHARGES_REFUND',
  'STAFF_CREDIT',
  // RS-6 — a store the seller manages, paid back off-platform.
  'STORE_PAYOUT_IN',
  // RS-6 phase 3c / RS-7.
  'RESELLER_TRANSFER_CREDIT',
  'PREPAID_TRANSFER_CREDIT',
  'STORE_DISPUTE_IN',
]);

interface WalletRow {
  id: string;
  sellerId: string;
  currency: string;
  direction: string;
  amount: Prisma.Decimal;
  runningBalanceAfter: Prisma.Decimal;
  linkedOrderId: string | null;
  linkedEntryId: string | null;
}
interface BankRow {
  accountId: string;
  currency: string;
  ownerKind: string;
  sellerId: string | null;
  signedAmount: Prisma.Decimal;
  /** A seller's non-rupee entry: what it is worth to their wallet. */
  inrBookValue: Prisma.Decimal | null;
}
interface Topup {
  sellerId: string;
  bankAccountId: string;
  currency: string;
  amount: Prisma.Decimal;
  credited: Prisma.Decimal;
}

interface StoreRow {
  id: string;
  storeId: string;
  sellerId: string;
  direction: string;
  amount: Prisma.Decimal;
  runningBalanceAfter: Prisma.Decimal;
  // RS-6 phase 3c — what an order's entries carry.
  shareOf?: string | null;
  linkedOrderId?: string | null;
  linkedEntryId?: string | null;
}

/**
 * An in-memory request table (store top-up claims, store withdrawals) that
 * applies the where-clauses the services send: by id, by a status or a set
 * of statuses, by seller, and `id: { not }` for "every other request".
 */
function requestTable(rows: Array<Record<string, unknown> & { id: string; status: string }>) {
  let n = 0;
  const statusOk = (want: unknown, have: string): boolean =>
    want === undefined ||
    (typeof want === 'string'
      ? want === have
      : ((want as { in: string[] }).in ?? []).includes(have));
  const match =
    (w: Record<string, unknown>) => (r: Record<string, unknown> & { id: string; status: string }) =>
      (w['id'] === undefined ||
        (typeof w['id'] === 'string'
          ? r.id === w['id']
          : r.id !== (w['id'] as { not: string }).not)) &&
      (w['sellerId'] === undefined || r['sellerId'] === w['sellerId']) &&
      (w['storeId'] === undefined || r['storeId'] === w['storeId']) &&
      statusOk(w['status'], r.status);
  const withInclude = (r: Record<string, unknown>): Record<string, unknown> => ({
    ...r,
    store: { name: r['storeId'], displayName: null, seller: { companyName: 'Menev Store' } },
    bankAccount: { label: 'HDFC', bankName: 'HDFC Bank', accountNumber: '0001' },
    paidFromAccount: r['paidFromAccountId'] === undefined ? null : { label: 'HDFC' },
  });
  return {
    create: jest.fn(async (a: { data: Record<string, unknown> }) => {
      n += 1;
      const row = {
        status: 'PENDING',
        createdAt: new Date(),
        reviewNote: null,
        reviewedAt: null,
        resolvedAt: null,
        rejectionReason: null,
        bankReference: null,
        paidAt: null,
        note: null,
        transactionRef: null,
        proofSpacesKey: null,
        ...a.data,
        id: `req-${String(n).padStart(4, '0')}`,
      };
      rows.push(row);
      return withInclude(row);
    }),
    findUnique: jest.fn(
      async (a: { where: { id?: string } }) => rows.find((r) => r.id === a.where.id) ?? null,
    ),
    findUniqueOrThrow: jest.fn(async (a: { where: { id: string } }) => {
      const r = rows.find((x) => x.id === a.where.id);
      if (r === undefined) throw new Error('not found');
      return withInclude(r);
    }),
    updateMany: jest.fn(
      async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = rows.filter(match(a.where));
        for (const r of hit) Object.assign(r, a.data);
        return { count: hit.length };
      },
    ),
    update: jest.fn(async (a: { where: { id: string }; data: Record<string, unknown> }) => {
      const r = rows.find((x) => x.id === a.where.id);
      if (r !== undefined) Object.assign(r, a.data);
      return r;
    }),
    count: jest.fn(
      async (a: { where: Record<string, unknown> }) => rows.filter(match(a.where)).length,
    ),
    groupBy: jest.fn(async (a: { where: Record<string, unknown> }) => {
      const by = new Map<string, Prisma.Decimal>();
      for (const r of rows.filter(match(a.where))) {
        const k = String(r['storeId']);
        by.set(k, (by.get(k) ?? ZERO).add(r['amountInr'] as Prisma.Decimal));
      }
      return [...by].map(([storeId, sum]) => ({ storeId, _sum: { amountInr: sum } }));
    }),
    aggregate: jest.fn(async (a: { where: Record<string, unknown> }) => {
      const hit = rows.filter(match(a.where));
      return {
        _sum: { amountInr: hit.reduce((t, r) => t.add(r['amountInr'] as Prisma.Decimal), ZERO) },
        _count: { _all: hit.length },
      };
    }),
  };
}

/** RS-6 phase 3c — a reseller store's order in the world, as its snapshot says. */
interface ResellerOrderSpec {
  id: string;
  sellerId: string;
  storeId: string;
  paymentMode: PaymentMode;
  cod: string | null;
  /** Σ transfer price × quantity (one line of one unit). */
  transfer: string;
  /** The delivery fee's charge line, when the order has one. */
  deliveryFee?: string;
  percents: { delivery?: string; codFee?: string; codTax?: string; instant?: string };
  storeCredit: [ResellerCreditTrigger, number];
  sellerCredit: [ResellerCreditTrigger, number];
}

type CreditRow = Record<string, unknown> & {
  id: string;
  orderId: string;
  party: string;
  status: string;
  dueAt: Date | null;
  timesCredited: number;
};

function makeWorld(
  orders: Array<{ id: string; sellerId: string; cod: string }>,
  /** The two independent COD fees, as percents. Both off by default. */
  fees: { collection?: string; instant?: string } = {},
  /**
   * RS-6 — the seller's reseller stores in this world, and who manages each
   * one's wallet. Empty for every scenario written before stores existed,
   * which therefore run exactly as they did.
   */
  stores: ReadonlyArray<{ id: string; sellerId: string; managedBy: 'SELLER' | 'SKYDROP' }> = [],
  /** RS-6 phase 3c — reseller orders; empty runs every channel scenario unchanged. */
  resellerOrders: readonly ResellerOrderSpec[] = [],
) {
  const wallet: WalletRow[] = [];
  const bank: BankRow[] = [];
  // Accepted top-ups: what arrived in the account, what the wallet was credited.
  const topups: Topup[] = [];
  const lines: Array<{
    orderId: string;
    settledInr: Prisma.Decimal;
    shortfallInr: Prisma.Decimal;
  }> = [];
  let seq = 0;
  // RS-6 — the store wallet ledger and the two request queues.
  const storeRows: StoreRow[] = [];
  const topupReqs: Array<Record<string, unknown> & { id: string; status: string }> = [];
  const withdrawalReqs: Array<Record<string, unknown> & { id: string; status: string }> = [];
  const nextId = (): string => `id-${String((seq += 1)).padStart(6, '0')}`;

  // ── RS-6 phase 3c: reseller orders, their credit plan and charge lines ──
  const rState = new Map(
    resellerOrders.map((o) => [
      o.id,
      {
        status: OrderStatus.PENDING_CONFIRMATION as OrderStatus,
        delivered: false,
        charge: 'ESTIMATED',
      },
    ]),
  );
  const resellerRow = (o: ResellerOrderSpec): Record<string, unknown> => ({
    id: o.id,
    orderNumber: o.id,
    sellerId: o.sellerId,
    storeId: o.storeId,
    status: rState.get(o.id)?.status ?? OrderStatus.PENDING_CONFIRMATION,
    paymentMode: o.paymentMode,
    codAmountInr: o.cod === null ? null : D(o.cod),
    resellerTermsVersionId: 'terms-1',
    resellerDeliveryFeeStorePercent: D(o.percents.delivery ?? '0'),
    resellerReturnFeeStorePercent: D('0'),
    resellerCustomerReturnFeeStorePercent: D('0'),
    resellerCodFeeStorePercent: D(o.percents.codFee ?? '0'),
    resellerCodTaxStorePercent: D(o.percents.codTax ?? '0'),
    resellerInstantPayFeeStorePercent: D(o.percents.instant ?? '0'),
    resellerStoreCreditTrigger: o.storeCredit[0],
    resellerStoreCreditDays: o.storeCredit[1],
    resellerSellerCreditTrigger: o.sellerCredit[0],
    resellerSellerCreditDays: o.sellerCredit[1],
    items: [
      {
        id: `${o.id}-item`,
        variantId: 'v-1',
        quantity: 1,
        resellerTransferPriceInr: D(o.transfer),
        resellerRetailUnitInr: D(o.cod ?? o.transfer),
        resellerMinRetailInr: null,
        resellerMaxRetailInr: null,
        resellerStockMode: 'SHARED',
      },
    ],
  });
  const credits: CreditRow[] = [];
  const creditMatch =
    (w: Record<string, unknown>) =>
    (r: CreditRow): boolean =>
      (w['id'] === undefined || r.id === w['id']) &&
      (w['orderId'] === undefined || r.orderId === w['orderId']) &&
      (w['status'] === undefined ||
        (typeof w['status'] === 'string'
          ? r.status === w['status']
          : (w['status'] as { in: string[] }).in.includes(r.status))) &&
      (w['dueAt'] === undefined ||
        (r.dueAt !== null && r.dueAt.getTime() <= (w['dueAt'] as { lte: Date }).lte.getTime()));
  const creditTable = {
    findMany: jest.fn(async (a: { where: Record<string, unknown> }) =>
      credits.filter(creditMatch(a.where)).map((r) => ({ ...r })),
    ),
    findUnique: jest.fn(async (a: { where: { id: string } }) => {
      const r = credits.find((x) => x.id === a.where.id);
      return r === undefined ? null : { ...r };
    }),
    createMany: jest.fn(async (a: { data: Array<Record<string, unknown>> }) => {
      for (const d of a.data) {
        if (credits.some((r) => r.orderId === d['orderId'] && r.party === d['party'])) continue;
        credits.push({
          status: 'WAITING',
          dueAt: null,
          creditedAt: null,
          reversedAt: null,
          skippedReason: null,
          timesCredited: 0,
          ...d,
          id: nextId(),
        } as unknown as CreditRow);
      }
      return { count: a.data.length };
    }),
    updateMany: jest.fn(
      async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = credits.filter(creditMatch(a.where));
        const { timesCredited, ...rest } = a.data;
        for (const r of hit) {
          Object.assign(r, rest);
          if (timesCredited !== undefined) r.timesCredited += 1;
        }
        return { count: hit.length };
      },
    ),
  };
  const valMatch = (want: unknown, have: unknown): boolean =>
    want === undefined ||
    (want !== null && typeof want === 'object' && 'in' in want
      ? (want as { in: unknown[] }).in.includes(have)
      : want === have);
  const storeWhere =
    (w: Record<string, unknown>) =>
    (r: StoreRow): boolean => {
      const row = r as unknown as Record<string, unknown>;
      const base = ['storeId', 'linkedOrderId', 'direction', 'shareOf'].every((k) =>
        valMatch(w[k], row[k] ?? null),
      );
      const or = w['OR'] as Array<Record<string, unknown>> | undefined;
      return base && (or === undefined || or.some((c) => storeWhere(c)(r)));
    };

  const dirMatch = (direction: unknown, d: string): boolean =>
    direction === undefined ||
    (typeof direction === 'string'
      ? direction === d
      : ((direction as { in: string[] }).in ?? []).includes(d));
  const walletWhere = (w: Record<string, unknown>) => (r: WalletRow) =>
    (w['linkedOrderId'] === undefined || r.linkedOrderId === w['linkedOrderId']) &&
    (w['sellerId'] === undefined || r.sellerId === w['sellerId']) &&
    (w['currency'] === undefined || r.currency === w['currency']) &&
    dirMatch(w['direction'], r.direction);

  const ledger = {
    post: jest.fn(
      async (input: {
        accountId: string;
        signedAmount: Prisma.Decimal;
        amountCurrency: string;
        owner: { kind: string; sellerId?: string };
        inrBookValue?: Prisma.Decimal | null;
      }) => {
        bank.push({
          accountId: input.accountId,
          currency: input.amountCurrency,
          ownerKind: input.owner.kind,
          sellerId: input.owner.sellerId ?? null,
          signedAmount: input.signedAmount,
          inrBookValue: input.inrBookValue ?? null,
        });
        return { id: nextId() };
      },
    ),
    // As the real one: what one owner holds in one account, summed.
    ownerBalance: jest.fn(
      async (accountId: string, owner: { kind: string; sellerId?: string | null }) =>
        bank
          .filter(
            (b) =>
              b.accountId === accountId &&
              b.ownerKind === owner.kind &&
              (owner.kind !== 'SELLER' || b.sellerId === owner.sellerId),
          )
          .reduce((t, b) => t.add(b.signedAmount), ZERO),
    ),
    // As the real one: a seller's units (and rupee book) in one account.
    sellerBook: jest.fn(async (sellerId: string, accountId: string, currency: string) => {
      const units = bank
        .filter(
          (b) =>
            b.ownerKind === 'SELLER' &&
            b.sellerId === sellerId &&
            b.accountId === accountId &&
            b.currency === currency,
        )
        .reduce((t, b) => t.add(b.signedAmount), ZERO);
      return { units, book: units };
    }),
  };
  const attribution = new SellerCashAttributionService(ledger as never);

  const tx: Record<string, unknown> = {
    $executeRaw: jest.fn(async () => 1),
    sellerWalletEntry: {
      findFirst: jest.fn(async (a: { where: Record<string, unknown> }) => {
        const found = wallet.filter(walletWhere(a.where));
        return found.length === 0 ? null : found[found.length - 1];
      }),
      findMany: jest.fn(
        async (a: { where: Record<string, unknown>; orderBy?: { id: 'desc' | 'asc' } }) => {
          const found = wallet.filter(walletWhere(a.where));
          return a.orderBy?.id === 'desc' ? [...found].reverse() : found;
        },
      ),
      count: jest.fn(
        async (a: { where: Record<string, unknown> }) => wallet.filter(walletWhere(a.where)).length,
      ),
    },
    gstWithholding: { upsert: jest.fn(async () => ({})) },
    bankEntry: {
      // By account, or by account AND currency — as the real one is asked.
      groupBy: jest.fn(async (a: { by: string[]; where: { sellerId: string } }) => {
        const withCurrency = a.by.includes('currency');
        const by = new Map<
          string,
          { accountId: string; currency: string; sum: Prisma.Decimal; book: Prisma.Decimal }
        >();
        for (const b of bank) {
          if (b.ownerKind !== 'SELLER' || b.sellerId !== a.where.sellerId) continue;
          const key = withCurrency ? `${b.accountId}|${b.currency}` : b.accountId;
          const cur = by.get(key) ?? {
            accountId: b.accountId,
            currency: b.currency,
            sum: ZERO,
            book: ZERO,
          };
          by.set(key, {
            ...cur,
            sum: cur.sum.add(b.signedAmount),
            book: cur.book.add(b.inrBookValue ?? ZERO),
          });
        }
        return [...by.values()].map((v) => ({
          accountId: v.accountId,
          ...(withCurrency ? { currency: v.currency } : {}),
          _sum: { signedAmount: v.sum, inrBookValue: v.book },
        }));
      }),
    },
    walletTopupRequest: {
      findFirst: jest.fn(
        async (a: { where: { sellerId: string; bankAccountId: string; currency: string } }) => {
          const t = topups
            .filter(
              (x) =>
                x.sellerId === a.where.sellerId &&
                x.bankAccountId === a.where.bankAccountId &&
                x.currency === a.where.currency,
            )
            .at(-1);
          return t === undefined ? null : { amount: t.amount, walletEntry: { amount: t.credited } };
        },
      ),
    },
    fxRate: { findFirst: jest.fn(async () => null) },
    platformBankAccount: {
      findFirst: jest.fn(async () => ({ id: 'hdfc', currency: 'INR', label: 'HDFC' })),
      findMany: jest.fn(async (a: { where: { id: { in: string[] } } }) =>
        a.where.id.in.map((id) => ({ id, label: id === 'hdfc' ? 'HDFC' : 'Tasin City' })),
      ),
    },
    seller: {
      findFirst: jest.fn(async () => ({ companyName: 'Menev Store', status: 'APPROVED' })),
    },
    courierSettlementLine: {
      // RS-6 phase 3c — has the courier paid on this order, and how much net.
      count: jest.fn(
        async (a: { where: { orderId: string } }) =>
          lines.filter((l) => l.orderId === a.where.orderId).length,
      ),
      aggregate: jest.fn(async (a: { where: { orderId: string } }) => ({
        _sum: {
          settledInr: lines
            .filter((l) => l.orderId === a.where.orderId)
            .reduce((t, l) => t.add(l.settledInr), ZERO),
        },
      })),
      groupBy: jest.fn(async (a: { where: { orderId: { in: string[] } } }) => {
        const by = new Map<string, { settled: Prisma.Decimal; short: Prisma.Decimal }>();
        for (const l of lines) {
          if (!a.where.orderId.in.includes(l.orderId)) continue;
          const cur = by.get(l.orderId) ?? { settled: ZERO, short: ZERO };
          by.set(l.orderId, {
            settled: cur.settled.add(l.settledInr),
            short: cur.short.add(l.shortfallInr),
          });
        }
        return [...by].map(([orderId, v]) => ({
          orderId,
          _sum: { settledInr: v.settled, shortfallInr: v.short },
        }));
      }),
    },
    courierSettlement: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async (a: { data: Record<string, unknown> }) => {
        const created = ((a.data['lines'] as { create: typeof lines }).create ?? []).map((l) => ({
          ...l,
        }));
        lines.push(...created);
        return {
          id: nextId(),
          ...a.data,
          earlyCodFeeInr: ZERO,
          freightDeductedInr: ZERO,
          rtoReversalInr: a.data['rtoReversalInr'] ?? ZERO,
          createdAt: new Date(),
          lines: created.map((l) => ({ ...l, expectedInr: ZERO, order: { orderNumber: 'x' } })),
        };
      }),
    },
    courierAccount: {
      findFirst: jest.fn(async () => ({
        id: 'acct-1',
        courier: { code: 'delhivery' },
        payoutBankAccount: { id: 'hdfc', currency: 'INR', isActive: true, deletedAt: null },
      })),
    },
    order: {
      findMany: jest.fn(async (a: { where: { id: { in: string[] } } }) => [
        ...orders
          .filter((o) => a.where.id.in.includes(o.id))
          .map((o) => ({
            id: o.id,
            orderNumber: o.id,
            codAmountInr: D(o.cod),
            sellerId: o.sellerId,
            storeKind: 'CHANNEL',
          })),
        ...resellerOrders
          .filter((o) => a.where.id.in.includes(o.id))
          .map((o) => ({
            id: o.id,
            orderNumber: o.id,
            codAmountInr: o.cod === null ? null : D(o.cod),
            sellerId: o.sellerId,
            storeKind: 'RESELLER',
          })),
      ]),
      // A reseller order's head and snapshot (the RESELLER filter is the caller's).
      findFirst: jest.fn(async (a: { where: { id: string } }) => {
        const o = resellerOrders.find((x) => x.id === a.where.id);
        return o === undefined ? null : resellerRow(o);
      }),
    },
    shipment: {
      findMany: jest.fn(async () => []),
      // The carrying courier's payout account — HDFC.
      findFirst: jest.fn(async () => ({
        courierAccount: {
          payoutBankAccount: { id: 'hdfc', currency: 'INR', isActive: true, deletedAt: null },
        },
      })),
    },
    orderEvent: {
      count: jest.fn(async (a: { where: { orderId: string; toStatus: string } }) =>
        a.where.toStatus === OrderStatus.DELIVERED &&
        rState.get(a.where.orderId)?.delivered === true
          ? 1
          : 0,
      ),
    },
    orderCharge: {
      findMany: jest.fn(async (a: { where: { orderId: string } }) => {
        const o = resellerOrders.find((x) => x.id === a.where.orderId);
        const st = rState.get(a.where.orderId);
        return o?.deliveryFee === undefined || st === undefined
          ? []
          : [
              {
                id: `${o.id}-charge`,
                type: 'BASE_SHIPPING',
                amountInr: D(o.deliveryFee),
                status: st.charge,
              },
            ];
      }),
      updateMany: jest.fn(
        async (a: { where: { id: { in: string[] } }; data: { status: string } }) => {
          for (const id of a.where.id.in) {
            const st = rState.get(id.replace(/-charge$/, ''));
            if (st !== undefined) st.charge = a.data.status;
          }
          return { count: a.where.id.in.length };
        },
      ),
    },
    resellerOrderCredit: creditTable,
    systemSetting: { findUnique: jest.fn(async () => ({ valueDecimal: '100' })) },
    // ── RS-6: reseller stores, their wallets and requests ─────────────
    sellerStore: {
      findMany: jest.fn(async (a: { where: { sellerId?: string } }) =>
        stores
          .filter((x) => a.where.sellerId === undefined || x.sellerId === a.where.sellerId)
          .map((x) => ({ id: x.id, sellerId: x.sellerId })),
      ),
      findFirst: jest.fn(async (a: { where: { id: string; sellerId?: string } }) => {
        const x = stores.find(
          (y) =>
            y.id === a.where.id &&
            (a.where.sellerId === undefined || y.sellerId === a.where.sellerId),
        );
        return x === undefined
          ? null
          : {
              id: x.id,
              sellerId: x.sellerId,
              name: x.id,
              displayName: null,
              status: 'ACTIVE',
              walletManagedBy: x.managedBy,
              seller: { companyName: 'Menev Store' },
            };
      }),
    },
    storeWalletEntry: {
      // Applies the where-clauses the services send (store, order, direction, share, OR).
      findFirst: jest.fn(
        async (a: { where: Record<string, unknown> }) =>
          storeRows.filter(storeWhere(a.where)).at(-1) ?? null,
      ),
      findMany: jest.fn(
        async (a: { where: Record<string, unknown>; orderBy?: { id: 'asc' | 'desc' } }) => {
          const found = storeRows.filter(storeWhere(a.where));
          return a.orderBy?.id === 'desc' ? [...found].reverse() : found;
        },
      ),
      count: jest.fn(
        async (a: { where: Record<string, unknown> }) =>
          storeRows.filter(storeWhere(a.where)).length,
      ),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async (a: { data: Omit<StoreRow, 'id'> }) => {
        const row: StoreRow = { ...a.data, id: nextId() };
        storeRows.push(row);
        return { id: row.id, runningBalanceAfter: row.runningBalanceAfter };
      }),
    },
    storeWalletSettings: { findUnique: jest.fn(async () => null) },
    withdrawalRequest: {
      aggregate: jest.fn(async () => ({ _sum: { amountRequested: null } })),
    },
    storeTopupRequest: requestTable(topupReqs),
    storeWithdrawalRequest: requestTable(withdrawalReqs),
  };
  tx['$transaction'] = async (fn: (t: unknown) => unknown) => fn(tx);

  const walletService = {
    applyEntry: jest.fn(
      async (
        _t: unknown,
        input: {
          sellerId: string;
          currency: Currency;
          direction: string;
          amount: Prisma.Decimal;
          linkedOrderId?: string;
          linkedEntryId?: string;
        },
      ) => {
        const last = wallet.filter((r) => r.sellerId === input.sellerId).at(-1);
        const before = last?.runningBalanceAfter ?? ZERO;
        const signed = CREDITS.has(input.direction) ? input.amount : input.amount.neg();
        const row: WalletRow = {
          id: nextId(),
          sellerId: input.sellerId,
          currency: input.currency,
          direction: input.direction,
          amount: input.amount,
          runningBalanceAfter: before.add(signed),
          linkedOrderId: input.linkedOrderId ?? null,
          linkedEntryId: input.linkedEntryId ?? null,
        };
        wallet.push(row);
        // As the real WalletService does, inside the same transaction.
        await attribution.apply(tx as never, {
          sellerId: input.sellerId,
          currency: input.currency,
          direction: input.direction as never,
          amount: input.amount,
          walletEntryId: row.id,
        });
        return { id: row.id, runningBalanceAfter: row.runningBalanceAfter };
      },
    ),
    recomputeCacheAfterCommit: jest.fn(async () => undefined),
    // The seller-managed top-up reads the seller's balance under the lock.
    balanceLive: jest.fn(
      async (sellerId: string) =>
        wallet.filter((r) => r.sellerId === sellerId).at(-1)?.runningBalanceAfter ?? ZERO,
    ),
  };
  const settings = {
    resolve: jest.fn(async (_s: string, key: string) => ({
      value: key.includes('gst')
        ? '18.00'
        : key.includes('instant_pay_fee')
          ? (fees.instant ?? '0.00')
          : key.includes('cod_collection_fee')
            ? (fees.collection ?? '0.00')
            : 'SETTLEMENT',
    })),
  };
  const codCredit = new CodCreditService(settings as never, walletService as never);
  // The REAL staff transfer service, over the same book and wallet.
  const staffTransfers = new StaffWalletTransferService(
    { client: tx } as never,
    walletService as never,
    ledger as never,
    attribution,
    { log: jest.fn(async () => 'a1') } as never,
  );
  const staff = (
    sellerId: string,
    direction: 'DEBIT' | 'CREDIT',
    amountInr: string,
  ): ReturnType<StaffWalletTransferService['execute']> =>
    staffTransfers.execute({
      sellerId,
      direction,
      amountInr,
      ...(direction === 'CREDIT' ? { bankAccountId: 'hdfc' } : {}),
      reason: 'Agreed with the seller on the phone on 12 September',
      staffId: 'staff-1',
    });
  /** Our own money arriving in HDFC (an owner contribution). */
  const fundCapital = async (amount: string): Promise<void> => {
    await ledger.post({
      accountId: 'hdfc',
      signedAmount: D(amount),
      amountCurrency: 'INR',
      owner: { kind: 'CAPITAL' },
    });
  };

  // ── RS-6: the REAL store wallet services over the same book ─────────
  const audit = { log: jest.fn(async () => 'a1') };
  // The negative-limit cap and the seller's minimum balance: both 0 here.
  const zeroSettings = { resolve: jest.fn(async () => ({ value: '0' })) };
  const storeWallet = new StoreWalletService(
    { client: tx } as never,
    attribution,
    zeroSettings as never,
    audit as never,
  );
  const withdrawalGuard = new WithdrawalRequestService(
    { client: tx } as never,
    {} as never,
    audit as never,
    walletService as never,
    zeroSettings as never,
    {} as never,
  );
  const sellerMoves = new SellerManagedStoreWalletService(
    { client: tx } as never,
    storeWallet,
    walletService as never,
    withdrawalGuard,
    audit as never,
  );
  const storeTopups = new StoreTopupService(
    { client: tx } as never,
    {} as never,
    audit as never,
    storeWallet,
    ledger as never,
    attribution,
  );
  const storeWithdrawals = new StoreWithdrawalService(
    { client: tx } as never,
    audit as never,
    storeWallet,
    ledger as never,
    attribution,
  );
  // RS-6 phase 3c — the REAL reseller order money, over the same book.
  const resellerMoney = new ResellerOrderMoneyService(
    { client: tx } as never,
    walletService as never,
    storeWallet,
    attribution,
    settings as never,
    {} as never,
    { persistForOrderSystem: jest.fn(async () => undefined) } as never,
    audit as never,
  );
  const svc = new CourierSettlementService(
    { client: tx } as never,
    { log: jest.fn(async () => 'a1') } as never,
    codCredit,
    walletService as never,
    ledger as never,
    attribution,
    // Channel worlds keep today's path byte-identical.
    resellerOrders.length === 0 ? NO_RESELLER_MONEY : (resellerMoney as never),
  );
  const storeUser = (storeId: string): never =>
    ({
      id: 'store-user-1',
      storeId,
      sellerId: stores.find((x) => x.id === storeId)?.sellerId ?? '',
      email: 'owner@store.test',
      fullName: 'Store Owner',
      emailVerifiedAt: null,
      jti: null,
      roleKey: 'owner',
      roleName: 'Owner',
      permissions: [],
    }) as never;
  const sellerOf = (storeId: string): string =>
    stores.find((x) => x.id === storeId)?.sellerId ?? '';
  /** The seller moves money into a store they manage. */
  const storeTopUpBySeller = (storeId: string, amountInr: string) =>
    sellerMoves.topUp(sellerOf(storeId), storeId, { amountInr }, { sellerUserId: 'su-1' });
  /** The seller records paying a store they manage, off-platform. */
  const storePayoutBySeller = (storeId: string, amountInr: string) =>
    sellerMoves.recordPayout(
      sellerOf(storeId),
      storeId,
      { amountInr, note: 'Paid by UPI on 14 September' },
      { sellerUserId: 'su-1' },
    );
  /** A charge on the store (phase 3b's fee share), written by the one writer. */
  const storeCharge = (storeId: string, amount: string) =>
    storeWallet.applyEntry(tx as never, {
      storeId,
      sellerId: sellerOf(storeId),
      direction: 'FEE_SHARE' as never,
      shareOf: 'ORDER_CHARGES' as never,
      amount: D(amount),
      actorType: 'SYSTEM' as never,
    });
  /** A store fee share given back. */
  const storeRefund = (storeId: string, amount: string) =>
    storeWallet.applyEntry(tx as never, {
      storeId,
      sellerId: sellerOf(storeId),
      direction: 'SHARE_REFUND' as never,
      shareOf: 'ORDER_CHARGES' as never,
      amount: D(amount),
      actorType: 'SYSTEM' as never,
    });
  /** A Skydrop-managed store's claim, submitted and accepted. */
  const storeClaimAccepted = async (storeId: string, amountInr: string): Promise<void> => {
    const claim = await storeTopups.submit(storeUser(storeId), {
      bankAccountId: 'hdfc',
      amountInr,
      transactionRef: `UTR-${nextId()}`,
    });
    await storeTopups.accept(claim.id, 'staff-1', null);
  };
  const storeWithdrawRequest = (storeId: string, amountInr: string) =>
    storeWithdrawals.request(storeUser(storeId), {
      amountInr,
      payeeName: 'Kolkata Kurtis',
      payeeAccountNumber: '50100012345678',
      payeeIfsc: 'HDFC0001234',
      payeeBankName: 'HDFC Bank',
    });
  /** A Skydrop-managed store's withdrawal: requested, approved, paid from HDFC. */
  const storeWithdraw = async (storeId: string, amountInr: string): Promise<void> => {
    const req = await storeWithdrawRequest(storeId, amountInr);
    await storeWithdrawals.approve(req.id, 'staff-1');
    await storeWithdrawals.pay(req.id, 'staff-1', {
      paidFromAccountId: 'hdfc',
      bankReference: `NEFT-${nextId()}`,
      paidAt: '2026-09-14T10:00:00.000Z',
    });
  };
  const storeBalanceOf = (storeId: string): Prisma.Decimal =>
    storeRows.filter((r) => r.storeId === storeId).at(-1)?.runningBalanceAfter ?? ZERO;
  /** max(0, seller wallet + Σ that seller's store wallets) — the RS-6 invariant's right side. */
  const groupOwed = (sellerId: string): string => {
    const own = wallet.filter((r) => r.sellerId === sellerId).at(-1)?.runningBalanceAfter ?? ZERO;
    const group = stores
      .filter((x) => x.sellerId === sellerId)
      .reduce((t, x) => t.add(storeBalanceOf(x.id)), own);
    return (group.lessThan(0) ? ZERO : group).toFixed(2);
  };
  /** What the seller may withdraw — the ONE WAL-3 method, stores included. */
  const sellerWithdrawable = async (sellerId: string): Promise<string> => {
    const balance =
      wallet.filter((r) => r.sellerId === sellerId).at(-1)?.runningBalanceAfter ?? ZERO;
    return (
      await withdrawalGuard.withdrawableBalance(sellerId, Currency.INR, balance, tx as never)
    ).toFixed(2);
  };

  /** A charge taken while the seller held nothing: a receivable, no bank entry. */
  const owe = async (sellerId: string, amount: string): Promise<void> => {
    await walletService.applyEntry(null, {
      sellerId,
      currency: Currency.INR,
      direction: 'ORDER_CHARGES',
      amount: D(amount),
    });
  };
  /**
   * A top-up in taka into our Tasin account, as `WalletTopupService.accept`
   * does it: the wallet is credited the rupees, the taka lands as theirs,
   * and the share of it that repays a debt becomes ours in proportion.
   */
  const topUp = async (sellerId: string, taka: string, inr: string): Promise<void> => {
    const amount = D(taka);
    const credited = D(inr);
    const split = await attribution.debtSplit(tx as never, sellerId, credited);
    const entry = await walletService.applyEntry(null, {
      sellerId,
      currency: Currency.INR,
      direction: 'TOPUP',
      amount: credited,
    });
    topups.push({ sellerId, bankAccountId: 'tasin', currency: 'BDT', amount, credited });
    await ledger.post({
      accountId: 'tasin',
      signedAmount: amount,
      amountCurrency: 'BDT',
      owner: { kind: 'SELLER', sellerId },
      inrBookValue: credited,
    });
    await attribution.repayDebt(tx as never, {
      sellerId,
      accountId: 'tasin',
      currency: Currency.BDT,
      amount: amount.mul(split.toCapital).div(credited).toDecimalPlaces(2),
      reference: entry.id,
      inrValue: split.toCapital,
    });
  };
  /** A charge given back (ORDER_CHARGES_REFUND): TO_SELLER, clamped by debt. */
  const refund = async (sellerId: string, amount: string): Promise<void> => {
    await walletService.applyEntry(null, {
      sellerId,
      currency: Currency.INR,
      direction: 'ORDER_CHARGES_REFUND',
      amount: D(amount),
    });
  };
  /**
   * What the book holds for them, every currency valued in rupees: rupees
   * as they are, anything else by its BOOK value — what it is worth to
   * their wallet, which is what the invariant compares.
   */
  const held = (sellerId: string): string =>
    bank
      .filter((b) => b.ownerKind === 'SELLER' && b.sellerId === sellerId)
      .reduce(
        (t, b) => t.add(b.currency === 'INR' ? b.signedAmount : (b.inrBookValue ?? ZERO)),
        ZERO,
      )
      .toFixed(2);
  /** The units of one currency held for them — a spent holding must read 0. */
  const units = (sellerId: string, currency: string): string =>
    bank
      .filter((b) => b.ownerKind === 'SELLER' && b.sellerId === sellerId && b.currency === currency)
      .reduce((t, b) => t.add(b.signedAmount), ZERO)
      .toFixed(2);
  /** Our own rupees across the book. */
  const capital = (): string =>
    bank
      .filter((b) => b.ownerKind === 'CAPITAL' && b.currency === 'INR')
      .reduce((t, b) => t.add(b.signedAmount), ZERO)
      .toFixed(2);
  const owed = (sellerId: string): string => {
    const bal = wallet.filter((r) => r.sellerId === sellerId).at(-1)?.runningBalanceAfter ?? ZERO;
    return (bal.lessThan(0) ? ZERO : bal).toFixed(2);
  };
  const accountTotal = (): string =>
    bank
      .filter((b) => b.currency === 'INR')
      .reduce((t, b) => t.add(b.signedAmount), ZERO)
      .toFixed(2);
  let n = 0;
  const pay = async (
    amountInr: string,
    paid: Array<[string, string]>,
    reversals: Array<[string, string]> = [],
  ): Promise<void> => {
    n += 1;
    await svc.record('staff-1', {
      courierAccountId: 'acct-1',
      reference: `PAYOUT-${n}`,
      amountInr,
      receivedAt: '2026-09-01T10:00:00.000Z',
      lines: paid.map(([orderId, settledInr]) => ({ orderId, settledInr })),
      ...(reversals.length === 0
        ? {}
        : {
            deductions: {
              rtoReversals: reversals.map(([orderId, amt]) => ({ orderId, amountInr: amt })),
            },
          }),
    });
  };
  /**
   * Delivered under Instant Pay, as `AccrualExecutionService` does it: the
   * COD is fronted from capital (less any part that repays a debt), THEN
   * credited, so its tax and both fees find cash to make ours.
   */
  const deliverInstantPay = async (orderId: string): Promise<void> => {
    const o = orders.find((x) => x.id === orderId);
    if (o === undefined) throw new Error(`no order ${orderId}`);
    const gross = D(o.cod);
    if (!(await codCredit.isCredited(tx as never, orderId))) {
      const split = await attribution.debtSplit(tx as never, o.sellerId, gross);
      await attribution.front(tx as never, {
        sellerId: o.sellerId,
        amount: split.toSeller,
        accountId: 'hdfc',
        reference: orderId,
      });
    }
    await codCredit.creditForOrder(tx as never, {
      orderId,
      sellerId: o.sellerId,
      grossInr: gross,
      mode: 'INSTANT_PAY',
    });
  };
  /** The raw wallet balance — owed() clamps at zero and would hide a debt. */
  const balance = (sellerId: string): string =>
    (wallet.filter((r) => r.sellerId === sellerId).at(-1)?.runningBalanceAfter ?? ZERO).toFixed(2);
  /** Every wallet entry on an order, as `direction amount`. */
  const entriesOf = (orderId: string): string[] =>
    wallet
      .filter((r) => r.linkedOrderId === orderId)
      .map((r) => `${r.direction} ${r.amount.toFixed(2)}`);
  return {
    /** Every advisory lock the payout path took: (strings, namespace, key). */
    locks: tx['$executeRaw'] as jest.Mock,
    pay,
    owe,
    topUp,
    refund,
    held,
    units,
    owed,
    accountTotal,
    capital,
    deliverInstantPay,
    balance,
    entriesOf,
    staff,
    fundCapital,
    /** How many bank rows exist — a staff debit on a seller holding nothing must add none. */
    bankRows: (): number => bank.length,
    // RS-6
    storeTopUpBySeller,
    storePayoutBySeller,
    storeCharge,
    storeRefund,
    storeClaimAccepted,
    storeWithdrawRequest,
    storeWithdraw,
    storeBalance: (storeId: string): string => storeBalanceOf(storeId).toFixed(2),
    groupOwed,
    sellerWithdrawable,
    // RS-6 phase 3c
    resellerMoney,
    tx,
    /** The order moves, as `transitionStatus` would, before its listener runs. */
    setStatus: (orderId: string, status: OrderStatus): void => {
      const st = rState.get(orderId);
      if (st === undefined) return;
      st.status = status;
      if (status === OrderStatus.DELIVERED) st.delivered = true;
    },
    creditsOf: (orderId: string): string[] =>
      credits
        .filter((c) => c.orderId === orderId)
        .map((c) => `${c.party} ${c.status}`)
        .sort(),
    storeEntriesOf: (orderId: string): string[] =>
      storeRows
        .filter((r) => r.linkedOrderId === orderId)
        .map((r) => `${r.direction} ${r.amount.toFixed(2)}`),
  };
}

type World = ReturnType<typeof makeWorld>;

describe('a payout takes its locks in the one order that cannot cycle', () => {
  it('every seller WALLET, then the receiving account’s key, then the attribution key', async () => {
    // WALLET < ACCOUNT < ATTRIBUTION, never going back down on a FIRST
    // acquisition (re-taking a lock already held never waits). reconcile()
    // takes ACCOUNT → ATTRIBUTION and no WALLET, so with this order no
    // payout and no reconcile can each hold what the other waits for.
    const w = makeWorld([
      { id: 'a', sellerId: 's', cod: '1000' },
      { id: 'b', sellerId: 't', cod: '500' },
    ]);
    await w.owe('s', '100');
    w.locks.mockClear();
    await w.pay('1500', [
      ['a', '1000'],
      ['b', '500'],
    ]);
    const attribution = advisoryKey(ATTRIBUTION_RECONCILE_KEY);
    const account = advisoryKey(accountReconcileKey('hdfc'));
    const seen = new Set<string>();
    const ranks: number[] = [];
    for (const c of w.locks.mock.calls as Array<[unknown, number, number]>) {
      const [, ns, key] = c;
      const id = `${ns}|${key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (ns === AdvisoryLock.WALLET) ranks.push(0);
      else if (ns === AdvisoryLock.BANK_RECONCILE) ranks.push(key === attribution ? 2 : 1);
    }
    expect(seen.has(`${AdvisoryLock.BANK_RECONCILE}|${account}`)).toBe(true);
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
    expect(ranks.filter((r) => r === 0)).toHaveLength(2);
    // And the invariant still holds.
    expect(w.held('s')).toBe(w.owed('s'));
    expect(w.held('t')).toBe(w.owed('t'));
  });
});

describe('the bank book holds each seller exactly what their wallet owes them', () => {
  it('a seller in credit: held the COD less the tax on it', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.pay('1000', [['a', '1000']]);
    // Credited 1000, tax 152.54 withheld: owed 847.46, and the tax is ours.
    expect(w.owed('s')).toBe('847.46');
    expect(w.held('s')).toBe('847.46');
    expect(w.accountTotal()).toBe('1000.00');
  });

  it('a seller in debt by less than the COD: the debt is repaid first', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.owe('s', '300');
    await w.pay('1000', [['a', '1000']]);
    expect(w.owed('s')).toBe('547.46');
    expect(w.held('s')).toBe('547.46');
    expect(w.accountTotal()).toBe('1000.00');
  });

  it('a seller in debt by more than the COD: nothing is held for them', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.owe('s', '1500');
    await w.pay('1000', [['a', '1000']]);
    expect(w.owed('s')).toBe('0.00');
    expect(w.held('s')).toBe('0.00');
  });

  it('when the tax is more than the COD left after the debt, nothing is held', async () => {
    // Owes 900: 100 of the 1000 is theirs, then 152.54 of tax takes that
    // and leaves them 52.54 in debt.
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.owe('s', '900');
    await w.pay('1000', [['a', '1000']]);
    expect(w.owed('s')).toBe('0.00');
    expect(w.held('s')).toBe('0.00');
  });

  it('a part-payment then the rest: held once, for the credit the first payout made', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.pay('600', [['a', '600']]);
    await w.pay('400', [['a', '400']]);
    expect(w.owed('s')).toBe('847.46');
    expect(w.held('s')).toBe('847.46');
    expect(w.accountTotal()).toBe('1000.00');
  });

  it('a COD reversed on a later payout is taken back, tax returned, and the books still agree', async () => {
    const w = makeWorld([
      { id: 'a', sellerId: 's', cod: '1000' },
      { id: 'b', sellerId: 's', cod: '2000' },
    ]);
    await w.pay('1000', [['a', '1000']]);
    // Payout 2 pays for b (2000) and claws back a's 1000: 1000 lands.
    await w.pay('1000', [['b', '2000']], [['a', '1000']]);
    // 847.46 + (2000 − 305.08) − 1000 + 152.54 = 1694.92.
    expect(w.owed('s')).toBe('1694.92');
    expect(w.held('s')).toBe('1694.92');
    expect(w.accountTotal()).toBe('2000.00');
  });

  it('a reversed COD paid again later is credited again', async () => {
    const w = makeWorld([
      { id: 'a', sellerId: 's', cod: '1000' },
      { id: 'b', sellerId: 's', cod: '2000' },
    ]);
    await w.pay('1000', [['a', '1000']]);
    await w.pay('1000', [['b', '2000']], [['a', '1000']]);
    await w.pay('1000', [['a', '1000']]);
    expect(w.owed('s')).toBe('2542.38'); // 1694.92 + 847.46
    expect(w.held('s')).toBe('2542.38');
    expect(w.accountTotal()).toBe('3000.00');
  });

  it('a taka top-up is theirs, and a charge beyond their rupees takes it at the top-up rate', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.pay('1000', [['a', '1000']]);
    // ৳10,000 credited as ₹8,000: ₹0.80 a taka.
    await w.topUp('s', '10000', '8000');
    expect(w.owed('s')).toBe('8847.46');
    expect(w.held('s')).toBe('8847.46');
    // ₹1,047.46 of charges: the ₹847.46 of rupees, then ₹200 = ৳250. It
    // used to stop at the rupees and leave the ₹200 "theirs" in taka.
    await w.owe('s', '1047.46');
    expect(w.owed('s')).toBe('7800.00');
    expect(w.held('s')).toBe('7800.00');
  });

  it('a taka top-up while in debt repays the debt first, in proportion', async () => {
    const w = makeWorld([]);
    await w.owe('s', '300');
    // ₹800 credited: ₹300 repays the debt (৳375 is ours), ₹500 is theirs (৳625).
    await w.topUp('s', '1000', '800');
    expect(w.owed('s')).toBe('500.00');
    expect(w.held('s')).toBe('500.00');
  });

  it('a refund while in debt repays the debt before any of it is theirs', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.pay('1000', [['a', '1000']]);
    await w.owe('s', '1000'); // 847.46 taken, 152.54 owed
    expect(w.held('s')).toBe('0.00');
    await w.refund('s', '100'); // still 52.54 in debt: nothing is theirs
    expect(w.owed('s')).toBe('0.00');
    expect(w.held('s')).toBe('0.00');
    await w.refund('s', '200'); // 52.54 repays the debt, 147.46 is theirs
    expect(w.owed('s')).toBe('147.46');
    expect(w.held('s')).toBe('147.46');
    expect(w.accountTotal()).toBe('1000.00');
  });

  it('a short-paid reversal takes the whole credit back — and capital recovers the gap it absorbed', async () => {
    // G = ₹1,000 credited on a COD the courier paid ₹950 for (capital
    // absorbed ₹50), tax ₹152.54. The courier then takes its ₹950 back on
    // a payout that also pays another seller's ₹2,000.
    const w = makeWorld([
      { id: 'a', sellerId: 's', cod: '1000' },
      { id: 'b', sellerId: 't', cod: '2000' },
    ]);
    await w.pay('950', [['a', '950']]);
    expect(w.held('s')).toBe('847.46');
    expect(w.capital()).toBe('102.54'); // 152.54 of tax less the 50 absorbed
    await w.pay('1050', [['b', '2000']], [['a', '950']]);
    // The seller is owed nothing and holds nothing: capped at the courier's
    // ₹950, ₹50 used to stay "theirs" for a wallet at zero.
    expect(w.owed('s')).toBe('0.00');
    expect(w.held('s')).toBe('0.00');
    expect(w.owed('t')).toBe('1694.92');
    expect(w.held('t')).toBe('1694.92');
    expect(w.accountTotal()).toBe('2000.00');
    // All that is left ours is t's tax: the ₹50 absorbed on a came back.
    expect(w.capital()).toBe('305.08');
  });

  it('two taka top-ups at different rates are held at what was credited, and a charge of it all leaves nothing', async () => {
    // ৳1,000 credited ₹700, then ৳1,000 credited ₹800. Valued at the last
    // top-up's rate this read ৳2,000 × 0.80 = ₹1,600 against a ₹1,500
    // wallet, and a ₹1,500 charge took ৳1,875 and stranded ৳125 "theirs".
    const w = makeWorld([]);
    await w.topUp('s', '1000', '700');
    await w.topUp('s', '1000', '800');
    expect(w.owed('s')).toBe('1500.00');
    expect(w.held('s')).toBe('1500.00');
    await w.owe('s', '1500');
    expect(w.owed('s')).toBe('0.00');
    expect(w.held('s')).toBe('0.00');
    expect(w.units('s', 'BDT')).toBe('0.00');
  });

  it('charges in pieces go at the average rate, and the last one spends every unit exactly', async () => {
    const w = makeWorld([]);
    await w.topUp('s', '1000', '700');
    await w.topUp('s', '1000', '800');
    for (const charge of ['500', '333.33', '0.01', '666.66']) {
      await w.owe('s', charge);
      expect(w.held('s')).toBe(w.owed('s'));
    }
    expect(w.owed('s')).toBe('0.00');
    expect(w.units('s', 'BDT')).toBe('0.00');
  });

  describe('a COD reversal takes back what the wallet lost — whatever they held before it', () => {
    // s is paid ₹1,000 COD on a (₹847.46 after tax), moved to a starting
    // balance, then the courier takes a back on a payout that pays t ₹2,000.
    const run = async (moveTo: (w: World) => Promise<void>): Promise<World> => {
      const w = makeWorld([
        { id: 'a', sellerId: 's', cod: '1000' },
        { id: 'b', sellerId: 't', cod: '2000' },
      ]);
      await w.pay('1000', [['a', '1000']]);
      await moveTo(w);
      await w.pay('1000', [['b', '2000']], [['a', '1000']]);
      expect(w.accountTotal()).toBe('2000.00');
      expect(w.held('t')).toBe(w.owed('t'));
      return w;
    };

    it('starting at ₹0: nothing held before, nothing after', async () => {
      const w = await run((x) => x.owe('s', '847.46'));
      expect(w.owed('s')).toBe('0.00');
      expect(w.held('s')).toBe('0.00');
    });

    it('starting between the COD less its tax and the COD (₹900): the returned tax stays theirs', async () => {
      // 900 − 1,000 + 152.54 = 52.54. Taking the whole ₹1,000 after the
      // tax refund had moved in took the refund too, and held them ₹0.
      const w = await run((x) => x.refund('s', '52.54'));
      expect(w.owed('s')).toBe('52.54');
      expect(w.held('s')).toBe('52.54');
    });

    it('starting above the COD (₹1,500)', async () => {
      const w = await run((x) => x.refund('s', '652.54'));
      expect(w.owed('s')).toBe('652.54');
      expect(w.held('s')).toBe('652.54');
    });

    it('starting in debt (−₹200): nothing to take, and the debt grows by the reversal', async () => {
      const w = await run((x) => x.owe('s', '1047.46'));
      expect(w.owed('s')).toBe('0.00');
      expect(w.held('s')).toBe('0.00');
    });
  });
});

/**
 * The COD fee and the Instant Pay fee are INDEPENDENT (2026-09-12): the COD
 * fee on every COD credit, the Instant Pay fee on top of it for an Instant
 * Pay credit. Each is a charge, so each makes the seller's cash ours — and
 * the book must still hold exactly what the wallet owes after every step.
 * ₹1,180 at 18%: tax ₹180; 1% COD fee ₹10; 2.5% Instant Pay ₹25.
 */
describe('both COD fees keep the book equal to the wallet', () => {
  const FEES = { collection: '1.00', instant: '2.50' };

  it('a settled COD pays the COD fee only, and it is ours', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1180' }], FEES);
    await w.pay('1180', [['a', '1180']]);
    expect(w.owed('s')).toBe('990.00');
    expect(w.held('s')).toBe('990.00');
    expect(w.accountTotal()).toBe('1180.00');
    expect(w.capital()).toBe('190.00'); // tax 180 + COD fee 10
    expect(w.entriesOf('a')).toEqual([
      'COD_COLLECTION 1180.00',
      'GST_WITHHOLDING 180.00',
      'COD_COLLECTION_FEE 10.00',
    ]);
  });

  it('an Instant Pay COD is fronted, pays BOTH fees, and the payout repays the front', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1180' }], FEES);
    await w.deliverInstantPay('a');
    expect(w.owed('s')).toBe('965.00');
    expect(w.held('s')).toBe('965.00');
    // Fronting is a zero-sum pair: nothing has arrived yet.
    expect(w.accountTotal()).toBe('0.00');
    expect(w.entriesOf('a')).toEqual([
      'COD_COLLECTION 1180.00',
      'GST_WITHHOLDING 180.00',
      'COD_COLLECTION_FEE 10.00',
      'INSTANT_PAY_FEE 25.00',
    ]);
    // The courier pays: the order is already credited, so the cash is
    // capital's, repaying what we fronted. The seller is untouched.
    await w.pay('1180', [['a', '1180']]);
    expect(w.owed('s')).toBe('965.00');
    expect(w.held('s')).toBe('965.00');
    expect(w.accountTotal()).toBe('1180.00');
    expect(w.capital()).toBe('215.00'); // tax 180 + COD fee 10 + Instant Pay 25
  });

  it('an Instant Pay COD with a debt behind it: the debt is repaid first, fees still ours', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1180' }], FEES);
    await w.owe('s', '300');
    await w.deliverInstantPay('a');
    expect(w.owed('s')).toBe('665.00'); // 965 − 300
    expect(w.held('s')).toBe('665.00');
  });

  it('reversing an Instant Pay COD returns the tax and BOTH fees, once each', async () => {
    const w = makeWorld(
      [
        { id: 'a', sellerId: 's', cod: '1180' },
        { id: 'b', sellerId: 't', cod: '2000' },
      ],
      FEES,
    );
    await w.deliverInstantPay('a');
    await w.pay('1180', [['a', '1180']]);
    // Payout 2 pays b (settled: tax 305.08, COD fee 16.95) and claws back a.
    await w.pay('820', [['b', '2000']], [['a', '1180']]);
    // 965 − 1180 + 180 + 10 + 25 = 0 — not −25 or −10, which a fee left
    // unreturned would leave (owed() would clamp that to 0 and hide it).
    expect(w.balance('s')).toBe('0.00');
    expect(w.held('s')).toBe('0.00');
    expect(w.entriesOf('a').filter((e) => e.startsWith('COD_DEDUCTION_REFUND'))).toEqual([
      'COD_DEDUCTION_REFUND 180.00',
      'COD_DEDUCTION_REFUND 10.00',
      'COD_DEDUCTION_REFUND 25.00',
    ]);
    expect(w.owed('t')).toBe('1677.97'); // 2000 − 305.08 − 16.95
    expect(w.held('t')).toBe('1677.97');
    expect(w.accountTotal()).toBe('2000.00');
  });
});

/**
 * A transfer between our own accounts MOVES a seller's money and never
 * changes what their wallet owes them. The REAL BankLedgerService and
 * BankTransferService run here over an in-memory book: the wallet is
 * whatever they were credited before the move (a transfer never writes
 * one), and after every move the book must still equal it while each
 * account moves by exactly what its statement shows.
 */
function makeBook() {
  const ACCOUNTS: Record<string, Currency> = { hdfc: Currency.INR, tasin: Currency.BDT };
  const rows: BankRow[] = [];
  let wallet = ZERO;
  let seq = 0;
  const sum = (xs: Prisma.Decimal[]): Prisma.Decimal => xs.reduce((t, x) => t.add(x), ZERO);

  const db: Record<string, unknown> = {
    $executeRaw: jest.fn(async () => 1),
    platformBankAccount: {
      findUnique: jest.fn(async (a: { where: { id: string } }) => {
        const currency = ACCOUNTS[a.where.id];
        return currency === undefined
          ? null
          : { id: a.where.id, label: a.where.id, currency, deletedAt: null };
      }),
    },
    bankEntry: {
      create: jest.fn(
        async (a: {
          data: {
            accountId: string;
            currency: string;
            ownerKind: string;
            sellerId: string | null;
            signedAmount: Prisma.Decimal;
            inrBookValue: Prisma.Decimal | null;
          };
        }) => {
          rows.push({
            accountId: a.data.accountId,
            currency: a.data.currency,
            ownerKind: a.data.ownerKind,
            sellerId: a.data.sellerId,
            signedAmount: a.data.signedAmount,
            inrBookValue: a.data.inrBookValue,
          });
          return { id: `be-${(seq += 1)}` };
        },
      ),
      aggregate: jest.fn(
        async (a: { where: { accountId: string; ownerKind: string; sellerId?: string } }) => {
          const hit = rows.filter(
            (r) =>
              r.accountId === a.where.accountId &&
              r.ownerKind === a.where.ownerKind &&
              (a.where.sellerId === undefined || r.sellerId === a.where.sellerId),
          );
          return {
            _sum: {
              signedAmount: sum(hit.map((r) => r.signedAmount)),
              inrBookValue: sum(hit.map((r) => r.inrBookValue ?? ZERO)),
            },
          };
        },
      ),
    },
    bankTransfer: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: `t-${(seq += 1)}` })),
    },
    expenseCategory: { upsert: jest.fn(async () => ({ id: 'cat-bank' })) },
    // 1 INR = 1.25 BDT today — reached only by a row nobody valued.
    fxRate: { findFirst: jest.fn(async () => ({ fromCurrency: Currency.INR, rate: D('1.25') })) },
  };
  db['$transaction'] = async (fn: (t: unknown) => unknown) => fn(db);
  const audit = { log: jest.fn(async () => 'a1') };
  const ledger = new BankLedgerService({ client: db } as never, audit as never);
  const transfers = new BankTransferService({ client: db } as never, ledger, audit as never);

  /** Money that arrived as theirs, and the rupees their wallet was credited for it. */
  const fund = async (
    sellerId: string,
    accountId: string,
    units: string,
    credited: string,
  ): Promise<void> => {
    wallet = wallet.add(D(credited));
    await ledger.post({
      accountId,
      type: BankEntryType.SELLER_TOPUP,
      signedAmount: units,
      amountCurrency: ACCOUNTS[accountId] ?? Currency.INR,
      owner: { kind: BankOwnerKind.SELLER, sellerId },
      occurredAt: new Date(),
      inrBookValue: D(credited),
    });
  };
  const move = (input: {
    fromAccountId: string;
    toAccountId: string;
    amountOut: string;
    amountIn: string;
    quotedRate?: string;
    sellerId: string;
  }) => transfers.transfer({ ...input, movedAt: new Date(), staffId: 'staff-1' });
  const mine = (sellerId: string, accountId?: string): BankRow[] =>
    rows.filter(
      (r) =>
        r.ownerKind === 'SELLER' &&
        r.sellerId === sellerId &&
        (accountId === undefined || r.accountId === accountId),
    );
  /** Rupees at face, anything else at its book value — what the invariant compares. */
  const held = (sellerId: string): string =>
    sum(
      mine(sellerId).map((r) => (r.currency === 'INR' ? r.signedAmount : (r.inrBookValue ?? ZERO))),
    ).toFixed(2);
  const units = (sellerId: string, accountId: string): string =>
    sum(mine(sellerId, accountId).map((r) => r.signedAmount)).toFixed(2);
  const book = (sellerId: string, accountId: string): string =>
    sum(mine(sellerId, accountId).map((r) => r.inrBookValue ?? ZERO)).toFixed(2);
  /** Everything in the account, every owner: what its statement shows. */
  const total = (accountId: string): string =>
    sum(rows.filter((r) => r.accountId === accountId).map((r) => r.signedAmount)).toFixed(2);
  const owed = (): string => (wallet.lessThan(0) ? ZERO : wallet).toFixed(2);
  return { fund, move, held, units, book, total, owed, rows };
}

describe('a transfer moves a seller’s money and never changes what their wallet owes them', () => {
  it('quoted rupees → taka: the quoted taka carry the rupees that left; the gap is our FX', async () => {
    const b = makeBook();
    await b.fund('s', 'hdfc', '1000', '1000');
    const r = await b.move({
      fromAccountId: 'hdfc',
      toAccountId: 'tasin',
      amountOut: '1000',
      amountIn: '1350',
      quotedRate: '1.30',
      sellerId: 's',
    });
    expect(r.creditedToSeller).toBe('1300.00');
    expect(r.fxSpread).toBe('50.00');
    expect(b.held('s')).toBe(b.owed());
    expect(b.held('s')).toBe('1000.00');
    expect(b.units('s', 'tasin')).toBe('1300.00');
    expect(b.book('s', 'tasin')).toBe('1000.00');
    expect(b.total('hdfc')).toBe('0.00');
    expect(b.total('tasin')).toBe('1350.00');
  });

  it('unquoted taka → rupees at a rate off their average: credited the book, the gap is ours', async () => {
    // ৳2,000 credited ₹1,500 (average 0.75); the bank gives 0.74.
    const b = makeBook();
    await b.fund('s', 'tasin', '2000', '1500');
    const r = await b.move({
      fromAccountId: 'tasin',
      toAccountId: 'hdfc',
      amountOut: '2000',
      amountIn: '1480',
      sellerId: 's',
    });
    expect(r.creditedToSeller).toBe('1500.00');
    expect(r.fxSpread).toBe('-20.00');
    expect(b.held('s')).toBe(b.owed());
    expect(b.units('s', 'tasin')).toBe('0.00');
    expect(b.book('s', 'tasin')).toBe('0.00');
    expect(b.total('hdfc')).toBe('1480.00');
    expect(b.total('tasin')).toBe('0.00');
  });

  it('quoted taka → rupees is REFUSED and the book is untouched', async () => {
    // Obeyed, a 0.80 quote held them ₹1,600 against a ₹1,500 wallet:
    // (quote − average) × units = 0.05 × 2,000 = ₹100 of cash that is theirs
    // in the book and in no wallet.
    const b = makeBook();
    await b.fund('s', 'tasin', '2000', '1500');
    const before = b.rows.length;
    await expect(
      b.move({
        fromAccountId: 'tasin',
        toAccountId: 'hdfc',
        amountOut: '2000',
        amountIn: '1480',
        quotedRate: '0.80',
        sellerId: 's',
      }),
    ).rejects.toMatchObject({ response: { code: 'TRANSFER_QUOTE_INTO_WALLET_CURRENCY' } });
    expect(b.rows).toHaveLength(before);
    expect(b.held('s')).toBe('1500.00');
    expect(b.held('s')).toBe(b.owed());
  });

  it('two taka lots at different rates, moved to rupees in parts, go at the average', async () => {
    // ৳1,000 credited ₹700 and ৳1,000 credited ₹800: ৳2,000 worth ₹1,500.
    const b = makeBook();
    await b.fund('s', 'tasin', '1000', '700');
    await b.fund('s', 'tasin', '1000', '800');
    const first = await b.move({
      fromAccountId: 'tasin',
      toAccountId: 'hdfc',
      amountOut: '1000',
      amountIn: '770',
      sellerId: 's',
    });
    expect(first.creditedToSeller).toBe('750.00');
    expect(first.fxSpread).toBe('20.00');
    expect(b.held('s')).toBe(b.owed());
    // What stays behind keeps the same average.
    expect(b.units('s', 'tasin')).toBe('1000.00');
    expect(b.book('s', 'tasin')).toBe('750.00');

    const rest = await b.move({
      fromAccountId: 'tasin',
      toAccountId: 'hdfc',
      amountOut: '1000',
      amountIn: '740',
      sellerId: 's',
    });
    expect(rest.creditedToSeller).toBe('750.00');
    expect(rest.fxSpread).toBe('-10.00');
    expect(b.held('s')).toBe(b.owed());
    expect(b.held('s')).toBe('1500.00');
    expect(b.units('s', 'tasin')).toBe('0.00');
    expect(b.book('s', 'tasin')).toBe('0.00');
    expect(b.total('hdfc')).toBe('1510.00');
    expect(b.total('tasin')).toBe('0.00');
  });
});

describe('a staff wallet transfer keeps the book equal to the wallet', () => {
  it('a debit on a seller holding enough: their cash becomes ours, clamped exactly', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.pay('1000', [['a', '1000']]);
    const out = await w.staff('s', 'DEBIT', '500');
    expect(out.preview?.cashMovedInr).toBe('500.00');
    expect(out.preview?.withoutCashInr).toBe('0.00');
    expect(w.balance('s')).toBe('347.46');
    expect(w.held('s')).toBe(w.owed('s'));
    expect(w.held('s')).toBe('347.46');
    // A pair, never one entry: the account is what the statement says.
    expect(w.accountTotal()).toBe('1000.00');
  });

  it('a debit beyond what they hold: only what they hold moves, the rest is a receivable', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.pay('1000', [['a', '1000']]);
    const out = await w.staff('s', 'DEBIT', '1000');
    expect(out.preview?.cashMovedInr).toBe('847.46');
    expect(out.preview?.withoutCashInr).toBe('152.54');
    expect(out.preview?.sentence).toMatch(/they will owe us ₹152\.54/);
    expect(w.balance('s')).toBe('-152.54');
    expect(w.held('s')).toBe(w.owed('s'));
    expect(w.held('s')).toBe('0.00');
    expect(w.accountTotal()).toBe('1000.00');
  });

  it('a debit on a seller holding nothing writes NO bank entry', async () => {
    const w = makeWorld([]);
    await w.owe('s', '300');
    const before = w.bankRows();
    await w.staff('s', 'DEBIT', '200');
    expect(w.bankRows()).toBe(before);
    expect(w.balance('s')).toBe('-500.00');
    expect(w.held('s')).toBe(w.owed('s'));
  });

  it('a debit reaches their taka at the rate it was credited, and leaves nothing theirs', async () => {
    const w = makeWorld([]);
    await w.topUp('s', '1000', '800');
    await w.staff('s', 'DEBIT', '800');
    expect(w.units('s', 'BDT')).toBe('0.00');
    expect(w.held('s')).toBe('0.00');
    expect(w.held('s')).toBe(w.owed('s'));
  });

  it('a credit: our money in the chosen account becomes theirs', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.pay('1000', [['a', '1000']]);
    await w.fundCapital('5000');
    const capitalBefore = w.capital();
    const out = await w.staff('s', 'CREDIT', '100');
    expect(out.preview?.cashMovedInr).toBe('100.00');
    expect(w.held('s')).toBe('947.46');
    expect(w.held('s')).toBe(w.owed('s'));
    expect(D(w.capital()).equals(D(capitalBefore).sub(D('100')))).toBe(true);
  });

  it('a credit to a seller in debt clears the debt first — only the rest becomes cash of theirs', async () => {
    const w = makeWorld([]);
    await w.owe('s', '300');
    await w.fundCapital('1000');
    const out = await w.staff('s', 'CREDIT', '500');
    expect(out.preview?.withoutCashInr).toBe('300.00');
    expect(out.preview?.cashMovedInr).toBe('200.00');
    expect(w.balance('s')).toBe('200.00');
    expect(w.held('s')).toBe('200.00');
    expect(w.held('s')).toBe(w.owed('s'));
    expect(w.capital()).toBe('800.00');
  });

  it('a credit that only clears a debt moves no cash at all', async () => {
    const w = makeWorld([]);
    await w.owe('s', '300');
    const before = w.bankRows();
    await w.staff('s', 'CREDIT', '100');
    expect(w.bankRows()).toBe(before);
    expect(w.balance('s')).toBe('-200.00');
    expect(w.held('s')).toBe(w.owed('s'));
  });

  it('a credit bigger than our money in the account is refused, and nothing is written', async () => {
    const w = makeWorld([]);
    await w.fundCapital('50');
    await expect(w.staff('s', 'CREDIT', '100')).rejects.toMatchObject({
      response: { code: 'WALLET_TRANSFER_CAPITAL_SHORT' },
    });
    expect(w.balance('s')).toBe('0.00');
  });

  it('takes WALLET, then the account key, then the attribution key — never back down', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.pay('1000', [['a', '1000']]);
    w.locks.mockClear();
    await w.staff('s', 'DEBIT', '100');
    const attribution = advisoryKey(ATTRIBUTION_RECONCILE_KEY);
    const account = advisoryKey(accountReconcileKey('hdfc'));
    const seen = new Set<string>();
    const ranks: number[] = [];
    for (const [, ns, key] of w.locks.mock.calls as Array<[unknown, number, number]>) {
      const id = `${ns}|${key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (ns === AdvisoryLock.WALLET) ranks.push(0);
      else if (ns === AdvisoryLock.BANK_RECONCILE) ranks.push(key === attribution ? 2 : 1);
    }
    expect(seen.has(`${AdvisoryLock.BANK_RECONCILE}|${account}`)).toBe(true);
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
  });
});

/**
 * RS-6 — decision 7: our bank book knows ONLY the seller. A reseller store's
 * wallet is a ledger between the seller and that store; the cash behind it is
 * the SELLER's. So the TRE-8 invariant becomes
 *
 *   held for a seller = max(0, seller wallet + Σ that seller's store wallets)
 *
 * and is asserted after EVERY step below, through the REAL store wallet
 * services (the one writer, the seller-managed moves, the Skydrop-managed
 * claim and withdrawal) running over the same in-memory wallet and book.
 */
describe('RS-6 — a seller and their reseller stores are ONE pot in the bank book', () => {
  const STORES = [
    { id: 'st-a', sellerId: 's', managedBy: 'SELLER' as const },
    { id: 'st-b', sellerId: 's', managedBy: 'SKYDROP' as const },
  ];
  const world = (orders: Array<{ id: string; sellerId: string; cod: string }> = []): World =>
    makeWorld(orders, {}, STORES);
  const agrees = (w: World): void => {
    expect(w.held('s')).toBe(w.groupOwed('s'));
  };

  it('a SELLER-managed top-up moves money between two wallets and NO cash', async () => {
    const w = world([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.pay('1000', [['a', '1000']]);
    agrees(w);
    const rows = w.bankRows();
    const out = await w.storeTopUpBySeller('st-a', '500');
    expect(out.storeBalanceAfterInr).toBe('500.00');
    expect(w.balance('s')).toBe('347.46');
    expect(w.storeBalance('st-a')).toBe('500.00');
    // No bank entry either way: the pot did not change.
    expect(w.bankRows()).toBe(rows);
    expect(w.held('s')).toBe('847.46');
    agrees(w);
  });

  it('a recorded payout is the reverse — store −X, seller +X — and moves no cash either', async () => {
    const w = world([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.pay('1000', [['a', '1000']]);
    await w.storeTopUpBySeller('st-a', '500');
    const rows = w.bankRows();
    await w.storePayoutBySeller('st-a', '200');
    expect(w.storeBalance('st-a')).toBe('300.00');
    expect(w.balance('s')).toBe('547.46');
    expect(w.bankRows()).toBe(rows);
    agrees(w);
  });

  it('a top-up beyond what the seller could withdraw is refused, and nothing is written', async () => {
    const w = world([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.pay('1000', [['a', '1000']]);
    await expect(w.storeTopUpBySeller('st-a', '900')).rejects.toMatchObject({
      response: { code: 'STORE_TOPUP_EXCEEDS_WITHDRAWABLE' },
    });
    expect(w.storeBalance('st-a')).toBe('0.00');
    expect(w.balance('s')).toBe('847.46');
    agrees(w);
  });

  it('a payout beyond the store’s balance is refused', async () => {
    const w = world();
    await expect(w.storePayoutBySeller('st-a', '50')).rejects.toMatchObject({
      response: { code: 'STORE_PAYOUT_EXCEEDS_BALANCE' },
    });
    agrees(w);
  });

  it('a store going negative: its charge makes the seller’s cash ours, clamped — and the seller can withdraw that much less', async () => {
    const w = world([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.pay('1000', [['a', '1000']]);
    expect(await w.sellerWithdrawable('s')).toBe('847.46');
    await w.storeCharge('st-a', '300');
    expect(w.storeBalance('st-a')).toBe('-300.00');
    expect(w.held('s')).toBe('547.46');
    agrees(w);
    // The store's debt is the seller's exposure: it comes off what they may take.
    expect(await w.sellerWithdrawable('s')).toBe('547.46');
    // A refund on the store gives the cash back — to the group.
    await w.storeRefund('st-a', '100');
    expect(w.storeBalance('st-a')).toBe('-200.00');
    expect(w.held('s')).toBe('647.46');
    agrees(w);
  });

  it('a store charge on a group already in debt writes NO bank entry — it is a receivable', async () => {
    const w = world();
    await w.owe('s', '300');
    const rows = w.bankRows();
    await w.storeCharge('st-a', '100');
    expect(w.bankRows()).toBe(rows);
    expect(w.held('s')).toBe('0.00');
    agrees(w);
  });

  it('a refund on a store while the GROUP is in debt repays that debt before any of it is cash of theirs', async () => {
    const w = world([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.pay('1000', [['a', '1000']]);
    await w.storeCharge('st-a', '1000'); // group 847.46 − 1000 = −152.54
    expect(w.held('s')).toBe('0.00');
    agrees(w);
    await w.storeRefund('st-a', '200'); // group +47.46
    expect(w.held('s')).toBe('47.46');
    agrees(w);
  });

  it('a SKYDROP-managed top-up is held as the SELLER’s cash', async () => {
    const w = world();
    const before = w.accountTotal();
    await w.storeClaimAccepted('st-b', '1000');
    expect(w.storeBalance('st-b')).toBe('1000.00');
    expect(w.held('s')).toBe('1000.00');
    expect(D(w.accountTotal()).sub(D(before)).toFixed(2)).toBe('1000.00');
    agrees(w);
  });

  it('a SKYDROP-managed top-up while the seller’s group is in debt repays the debt first', async () => {
    const w = world();
    await w.owe('s', '300');
    await w.storeClaimAccepted('st-b', '1000');
    expect(w.held('s')).toBe('700.00');
    expect(w.capital()).toBe('300.00');
    agrees(w);
  });

  it('a SKYDROP-managed withdrawal pays the store out of the seller’s cash, and the book falls by exactly that', async () => {
    const w = world();
    await w.storeClaimAccepted('st-b', '1000');
    await w.storeWithdraw('st-b', '400');
    expect(w.storeBalance('st-b')).toBe('600.00');
    expect(w.held('s')).toBe('600.00');
    expect(w.accountTotal()).toBe('600.00');
    agrees(w);
  });

  it('a store owed money while its seller is in debt cannot draw cash we do not hold', async () => {
    const w = world();
    await w.owe('s', '500');
    await w.storeClaimAccepted('st-b', '300'); // group −200: all of it repaid debt
    expect(w.held('s')).toBe('0.00');
    agrees(w);
    await expect(w.storeWithdrawRequest('st-b', '100')).rejects.toMatchObject({
      response: { code: 'STORE_WITHDRAWAL_EXCEEDS_WITHDRAWABLE' },
    });
  });

  it('a seller with two stores: every step keeps held = max(0, seller + Σ stores)', async () => {
    const w = world([
      { id: 'a', sellerId: 's', cod: '1000' },
      { id: 'b', sellerId: 's', cod: '2000' },
    ]);
    await w.pay('1000', [['a', '1000']]);
    agrees(w);
    await w.storeTopUpBySeller('st-a', '400');
    agrees(w);
    await w.storeClaimAccepted('st-b', '500');
    agrees(w);
    await w.storeCharge('st-a', '600'); // st-a → −200
    agrees(w);
    await w.storeRefund('st-a', '50');
    agrees(w);
    await w.storeWithdraw('st-b', '300');
    agrees(w);
    await w.owe('s', '2000'); // the whole group into the red
    agrees(w);
    expect(w.held('s')).toBe('0.00');
    await w.storeClaimAccepted('st-b', '100'); // repays debt, holds nothing
    agrees(w);
    await w.pay('2000', [['b', '2000']]); // a COD lands on a group in debt
    agrees(w);
    // The account holds exactly what landed less what was paid out.
    expect(w.accountTotal()).toBe('3300.00');
  });

  it('a store payout takes WALLET, then the account key, then the attribution key — never back down', async () => {
    const w = world([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.pay('1000', [['a', '1000']]);
    await w.storeClaimAccepted('st-b', '100');
    w.locks.mockClear();
    // Paid from HDFC where the seller holds enough: cash leaves as theirs.
    await w.storeWithdraw('st-b', '50');
    const attribution = advisoryKey(ATTRIBUTION_RECONCILE_KEY);
    const seen = new Set<string>();
    const ranks: number[] = [];
    for (const [, ns, key] of w.locks.mock.calls as Array<[unknown, number, number]>) {
      const id = `${ns}|${key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (ns === AdvisoryLock.WALLET) ranks.push(0);
      else if (ns === AdvisoryLock.BANK_RECONCILE) ranks.push(key === attribution ? 2 : 1);
    }
    expect(ranks[0]).toBe(0);
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
    agrees(w);
  });
});

describe('RS-6 phase 3c — a reseller order keeps held = max(0, seller + Σ stores) at every step', () => {
  const STORES = [
    { id: 'st-a', sellerId: 's', managedBy: 'SELLER' as const },
    { id: 'st-b', sellerId: 's', managedBy: 'SKYDROP' as const },
  ];
  // COD ₹1,180 at 18%: tax 180.00, post-tax 1,000; COD fee 1% = 10.00; Instant Pay 2.5% = 25.00.
  // The store pays 50% of the tax and the COD fee, all of the Instant Pay fee and half the delivery fee.
  const PERCENTS = { delivery: '50', codFee: '50', codTax: '50', instant: '100' };
  const cod = (
    id: string,
    storeCredit: [ResellerCreditTrigger, number],
    sellerCredit: [ResellerCreditTrigger, number],
    over: Partial<ResellerOrderSpec> = {},
  ): ResellerOrderSpec => ({
    id,
    sellerId: 's',
    storeId: 'st-a',
    paymentMode: PaymentMode.COD,
    cod: '1180',
    transfer: '700',
    percents: PERCENTS,
    storeCredit,
    sellerCredit,
    ...over,
  });
  const ON_PAYOUT: [ResellerCreditTrigger, number] = [ResellerCreditTrigger.ON_PAYOUT, 0];
  const INSTANT: [ResellerCreditTrigger, number] = [ResellerCreditTrigger.INSTANT, 0];
  const AFTER_CONFIRMATION: [ResellerCreditTrigger, number] = [
    ResellerCreditTrigger.AFTER_CONFIRMATION,
    0,
  ];
  const world = (
    resellerOrders: ResellerOrderSpec[],
    channel: Array<{ id: string; sellerId: string; cod: string }> = [],
  ): World => makeWorld(channel, { collection: '1.00', instant: '2.50' }, STORES, resellerOrders);
  const agrees = (w: World): void => {
    expect(w.held('s')).toBe(w.groupOwed('s'));
  };
  const confirm = async (w: World, id: string): Promise<void> => {
    w.setStatus(id, OrderStatus.CONFIRMED);
    await w.resellerMoney.onConfirmed(id, new Date());
  };
  const deliver = async (w: World, id: string): Promise<void> => {
    w.setStatus(id, OrderStatus.DELIVERED);
    await w.resellerMoney.onDelivered(id, new Date(), true);
  };

  it('COD settled, both ON_PAYOUT: nothing moves at delivery; the payout credits each party its net', async () => {
    const w = world([cod('r1', ON_PAYOUT, ON_PAYOUT)]);
    await confirm(w, 'r1');
    await deliver(w, 'r1');
    // ON_PAYOUT counts from the payout: delivery arms neither.
    expect(w.creditsOf('r1')).toEqual(['SELLER WAITING', 'STORE WAITING']);
    agrees(w);
    await w.pay('1180', [['r1', '1180']]);
    // store 1180 − 700 − 90 − 5 = 385; seller 700 − 90 − 5 = 605; 990 = 1180 − 180 − 10.
    // The store's gross credit is COD − transfer; each share its own entry.
    expect(w.storeEntriesOf('r1')).toEqual([
      'ORDER_CREDIT 480.00',
      'COD_TAX_SHARE 90.00',
      'FEE_SHARE 5.00',
    ]);
    expect(w.entriesOf('r1')).toEqual([
      'RESELLER_TRANSFER_CREDIT 700.00',
      'GST_WITHHOLDING 90.00',
      'COD_COLLECTION_FEE 5.00',
    ]);
    expect(w.storeBalance('st-a')).toBe('385.00');
    expect(w.balance('s')).toBe('605.00');
    expect(w.held('s')).toBe('990.00');
    expect(w.accountTotal()).toBe('1180.00');
    expect(w.capital()).toBe('190.00');
    agrees(w);
    expect(w.creditsOf('r1')).toEqual(['SELLER CREDITED', 'STORE CREDITED']);
  });

  it('a second payout line on the same order credits nobody twice', async () => {
    const w = world([cod('r1', ON_PAYOUT, ON_PAYOUT)]);
    await deliver(w, 'r1');
    await w.pay('1000', [['r1', '1000']]);
    await w.pay('180', [['r1', '180']]);
    expect(w.storeBalance('st-a')).toBe('385.00');
    expect(w.balance('s')).toBe('605.00');
    agrees(w);
  });

  it('store INSTANT: fronted at delivery with the Instant Pay fee; the seller is paid at the payout', async () => {
    const w = world([cod('r1', INSTANT, ON_PAYOUT)]);
    await confirm(w, 'r1');
    await deliver(w, 'r1');
    // 1180 − 700 − 90 − 5 − 25 = 360, fronted from capital.
    expect(w.storeBalance('st-a')).toBe('360.00');
    expect(w.held('s')).toBe('360.00');
    expect(w.accountTotal()).toBe('0.00');
    agrees(w);
    await w.pay('1180', [['r1', '1180']]);
    expect(w.balance('s')).toBe('605.00');
    expect(w.held('s')).toBe('965.00');
    // Skydrop keeps the tax and both fees — exactly a channel Instant Pay order's 215.
    expect(w.capital()).toBe('215.00');
    agrees(w);
  });

  it('AFTER_CONFIRMATION, back undelivered: the fronted credit comes back and nobody holds a rupee', async () => {
    const w = world([cod('r1', AFTER_CONFIRMATION, ON_PAYOUT)]);
    await confirm(w, 'r1');
    expect(w.storeBalance('st-a')).toBe('385.00');
    agrees(w);
    w.setStatus('r1', OrderStatus.RTO_RECEIVED);
    await w.resellerMoney.onReturned('r1', 'Returned undelivered');
    expect(w.storeBalance('st-a')).toBe('0.00');
    expect(w.creditsOf('r1')).toEqual(['SELLER SKIPPED', 'STORE REVERSED']);
    expect(w.held('s')).toBe('0.00');
    expect(w.capital()).toBe('0.00');
    agrees(w);
  });

  it('cancelled before dispatch: the credit comes back and the pending one is skipped', async () => {
    const w = world([cod('r1', AFTER_CONFIRMATION, ON_PAYOUT)]);
    await confirm(w, 'r1');
    w.setStatus('r1', OrderStatus.CANCELLED);
    await w.resellerMoney.onEnded('r1', {
      kind: 'CALLED_OFF',
      parcelLeft: false,
      note: 'Cancelled',
    });
    expect(w.storeBalance('st-a')).toBe('0.00');
    expect(w.creditsOf('r1')).toEqual(['SELLER SKIPPED', 'STORE REVERSED']);
    agrees(w);
  });

  it('lost in transit: the credit comes back', async () => {
    const w = world([cod('r1', AFTER_CONFIRMATION, ON_PAYOUT)]);
    await confirm(w, 'r1');
    w.setStatus('r1', OrderStatus.LOST_IN_TRANSIT);
    await w.resellerMoney.onEnded('r1', { kind: 'LOST', parcelLeft: true, note: 'Lost' });
    expect(w.storeBalance('st-a')).toBe('0.00');
    expect(w.held('s')).toBe('0.00');
    agrees(w);
  });

  it('RTO after the courier paid: its reversal takes both credits back, per party', async () => {
    const w = world([cod('r1', ON_PAYOUT, ON_PAYOUT)], [{ id: 'c', sellerId: 's', cod: '2000' }]);
    await deliver(w, 'r1');
    await w.pay('1180', [['r1', '1180']]);
    agrees(w);
    // The next payout pays channel order c and takes r1's 1,180 back.
    await w.pay('820', [['c', '2000']], [['r1', '1180']]);
    expect(w.storeBalance('st-a')).toBe('0.00');
    expect(w.creditsOf('r1')).toEqual(['SELLER REVERSED', 'STORE REVERSED']);
    expect(w.accountTotal()).toBe('2000.00');
    agrees(w);
  });

  it('the delivery fee is split — seller ORDER_CHARGES + store FEE_SHARE — and a refund returns both', async () => {
    const w = world(
      [cod('r1', ON_PAYOUT, ON_PAYOUT, { deliveryFee: '236' })],
      [{ id: 'c', sellerId: 's', cod: '1000' }],
    );
    await w.pay('1000', [['c', '1000']]);
    const before = w.held('s');
    await w.resellerMoney.chargeDeliveryFee(w.tx as never, 'r1');
    await w.resellerMoney.chargeDeliveryFee(w.tx as never, 'r1'); // exactly once
    expect(w.entriesOf('r1')).toEqual(['ORDER_CHARGES 118.00']);
    expect(w.storeEntriesOf('r1')).toEqual(['FEE_SHARE 118.00']);
    agrees(w);
    await w.resellerMoney.refundDeliveryFee('r1', 'Cancelled before dispatch');
    expect(w.entriesOf('r1')).toEqual(['ORDER_CHARGES 118.00', 'ORDER_CHARGES_REFUND 118.00']);
    expect(w.storeBalance('st-a')).toBe('0.00');
    expect(w.held('s')).toBe(before);
    agrees(w);
  });

  it('prepaid: the store pays at confirmation, the seller is credited at delivery, the book agrees', async () => {
    const w = world([
      {
        id: 'p1',
        sellerId: 's',
        storeId: 'st-b',
        paymentMode: PaymentMode.PREPAID,
        cod: null,
        transfer: '700',
        deliveryFee: '236',
        percents: PERCENTS,
        storeCredit: ON_PAYOUT,
        sellerCredit: INSTANT,
      },
    ]);
    await w.storeClaimAccepted('st-b', '2000');
    agrees(w);
    await confirm(w, 'p1');
    expect(w.storeEntriesOf('p1')).toEqual(['PREPAID_DEBIT 700.00', 'FEE_SHARE 118.00']);
    expect(w.storeBalance('st-b')).toBe('1182.00');
    expect(w.creditsOf('p1')).toEqual(['SELLER WAITING']);
    agrees(w);
    await confirm(w, 'p1'); // a second confirmation takes nothing
    expect(w.storeBalance('st-b')).toBe('1182.00');
    await deliver(w, 'p1');
    expect(w.entriesOf('p1')).toEqual(['PREPAID_TRANSFER_CREDIT 700.00']);
    expect(w.held('s')).toBe('1882.00');
    agrees(w);
    await w.resellerMoney.chargeDeliveryFee(w.tx as never, 'p1'); // the seller's half only
    expect(w.entriesOf('p1')).toEqual(['PREPAID_TRANSFER_CREDIT 700.00', 'ORDER_CHARGES 118.00']);
    expect(w.storeEntriesOf('p1')).toEqual(['PREPAID_DEBIT 700.00', 'FEE_SHARE 118.00']);
    agrees(w);
  });

  it('prepaid cancelled before dispatch: the store gets back all it paid and the seller nothing', async () => {
    const w = world([
      {
        id: 'p1',
        sellerId: 's',
        storeId: 'st-b',
        paymentMode: PaymentMode.PREPAID,
        cod: null,
        transfer: '700',
        deliveryFee: '236',
        percents: PERCENTS,
        storeCredit: ON_PAYOUT,
        sellerCredit: INSTANT,
      },
    ]);
    await w.storeClaimAccepted('st-b', '2000');
    await confirm(w, 'p1');
    w.setStatus('p1', OrderStatus.CANCELLED);
    await w.resellerMoney.onEnded('p1', {
      kind: 'CALLED_OFF',
      parcelLeft: false,
      note: 'Cancelled',
    });
    await w.resellerMoney.refundDeliveryFee('p1', 'Cancelled before dispatch');
    expect(w.storeBalance('st-b')).toBe('2000.00');
    expect(w.balance('s')).toBe('0.00');
    expect(w.creditsOf('p1')).toEqual(['SELLER SKIPPED']);
    expect(w.held('s')).toBe('2000.00');
    agrees(w);
  });

  /*
    ── THE ORDER CHANGED (owner, 2026-09-18) ─────────────────────────────

    Seller staff — or the store — may change a reseller order, and the
    money is recalculated to the new one. The invariant to hold is the
    same one every other step holds: after EVERY step,
    held for the seller = max(0, seller wallet + Σ their store wallets).

    Two shapes, and the difference between them is the whole design:
      - nothing posted yet ⇒ the credit rows ARE the plan, so their
        figures are rewritten and no wallet moves;
      - money already posted ⇒ the credit is TAKEN BACK through the same
        reversal path a return uses and WRITTEN AGAIN at the new figures.
        The net movement is the difference; what the ledger shows is two
        legible entries rather than a signed patch across five directions.
  */
  it('re-priced BEFORE anything is credited: the plan moves, no wallet does', async () => {
    const order = cod('r1', ON_PAYOUT, ON_PAYOUT);
    const w = world([order]);
    await confirm(w, 'r1');
    expect(w.creditsOf('r1')).toEqual(['SELLER WAITING', 'STORE WAITING']);
    const before = { store: w.storeBalance('st-a'), seller: w.balance('s') };

    // The customer asked for a second unit on the call: COD and the
    // transfer total both double.
    order.cod = '2360';
    order.transfer = '1400';
    const out = await w.resellerMoney.recalculateAfterEdit('r1', { reason: 'Seller changed it' });

    expect(out.outcome).toBe('REPLANNED');
    expect(out.parties.map((p) => `${p.party} ${p.what}`).sort()).toEqual([
      'SELLER REPLANNED',
      'STORE REPLANNED',
    ]);
    // Nothing was written, so nothing moved.
    expect(w.storeBalance('st-a')).toBe(before.store);
    expect(w.balance('s')).toBe(before.seller);
    expect(w.storeEntriesOf('r1')).toEqual([]);
    expect(w.entriesOf('r1')).toEqual([]);
    agrees(w);

    // And the payout now pays the NEW figures: tax 360, COD fee 20,
    // store 2360 − 1400 − 180 − 10 = 770; seller 1400 − 180 − 10 = 1210.
    await deliver(w, 'r1');
    await w.pay('2360', [['r1', '2360']]);
    expect(w.storeBalance('st-a')).toBe('770.00');
    expect(w.balance('s')).toBe('1210.00');
    agrees(w);
  });

  it('money already PAID is refused, not re-worked-out — and nothing moves', async () => {
    /*
      The contents freeze at confirmation and a reseller credit runs at or
      after delivery, so an edit can never reach a paid credit; only god
      mode can put a paid order back where its lines are changeable. That
      is a bypass, and the answer to a bypass is to stop.

      It could not be written in any case: nine wallet directions may
      occur at most ONCE per order
      (`seller_wallet_entries_once_per_order_uq` — the guard against
      paying an order twice), and a reversal-then-rewrite needs a second
      `cod_collection` on the same order. This fake book has no such
      index, which is exactly why the refusal is asserted here rather
      than left to Postgres to discover.
    */
    const order = cod('r1', ON_PAYOUT, ON_PAYOUT);
    const w = world([order]);
    await confirm(w, 'r1');
    await deliver(w, 'r1');
    await w.pay('1180', [['r1', '1180']]);
    expect(w.creditsOf('r1')).toEqual(['SELLER CREDITED', 'STORE CREDITED']);
    expect(w.storeBalance('st-a')).toBe('385.00');
    expect(w.balance('s')).toBe('605.00');
    agrees(w);
    const entriesWere = w.storeEntriesOf('r1');

    order.cod = '2360';
    order.transfer = '1400';
    await expect(
      w.resellerMoney.recalculateAfterEdit('r1', { reason: 'Seller changed it' }),
    ).rejects.toThrow(/already been paid/);

    // Refused means refused: both wallets, both plans and the book are
    // exactly where the payout left them.
    expect(w.storeBalance('st-a')).toBe('385.00');
    expect(w.balance('s')).toBe('605.00');
    expect(w.creditsOf('r1')).toEqual(['SELLER CREDITED', 'STORE CREDITED']);
    expect(w.storeEntriesOf('r1')).toEqual(entriesWere);
    agrees(w);
  });

  /*
    RS-7 (2026-09-19) — THE ANSWER TO THAT REFUSAL.

    The test above pins that a PAID reseller order's figures cannot be
    re-worked-out: the once-per-order wallet unique would refuse the
    second `cod_collection` a rewrite needs, and that index is the guard
    against paying an order twice. So the correction is settled BETWEEN
    the two wallets through the dispute Skydrop already referees — no
    second credit, no weakened index, one money path.

    What this asserts is the property the whole RS-6 bank model rests on:
    a settlement moves money WITHIN the seller's group, so the group's
    total owed and therefore `held` are UNCHANGED, while the two wallets
    inside it move by exactly the settled amount in opposite directions.
    And `held = max(0, seller + Σ stores)` still holds after every step.
  */
  it('a correction SETTLES after the credits were paid — within the group, book unmoved', async () => {
    const w = world([cod('r1', ON_PAYOUT, ON_PAYOUT)]);
    await confirm(w, 'r1');
    await deliver(w, 'r1');
    await w.pay('1180', [['r1', '1180']]);
    expect(w.storeBalance('st-a')).toBe('385.00');
    expect(w.balance('s')).toBe('605.00');
    const bookWas = w.accountTotal();
    const capitalWas = w.capital();
    const heldWas = w.held('s');
    // The row COUNT, not only the total: a pair summing to zero would
    // leave every figure below unchanged while still writing cash lines
    // for money that never moved between banks. RS-7 writes NEITHER.
    const bankRowsWere = w.bankRows();
    agrees(w);

    // Re-pricing is refused — that is what the correction exists for.
    await expect(
      w.resellerMoney.recalculateAfterEdit('r1', { reason: 'Transfer price was wrong' }),
    ).resolves.toMatchObject({ outcome: 'UNCHANGED' });

    // The seller owes the store ₹120: the store was short-changed.
    await w.resellerMoney.settleStoreDispute(w.tx as never, {
      storeId: 'st-a',
      sellerId: 's',
      orderId: 'r1',
      payer: ResellerMoneyParty.SELLER,
      amount: new Prisma.Decimal('120.00'),
      ticketNumber: 'TK-2026-000042',
      staffId: 'staff-1',
    });
    expect(w.storeBalance('st-a')).toBe('505.00');
    expect(w.balance('s')).toBe('485.00');
    // NOT ours: no cash left, no capital moved, the group still holds
    // exactly what it held before.
    expect(w.accountTotal()).toBe(bookWas);
    expect(w.capital()).toBe(capitalWas);
    expect(w.held('s')).toBe(heldWas);
    expect(w.bankRows()).toBe(bankRowsWere);
    agrees(w);

    // The other direction, on the same order: a store may owe too.
    await w.resellerMoney.settleStoreDispute(w.tx as never, {
      storeId: 'st-a',
      sellerId: 's',
      orderId: 'r1',
      payer: ResellerMoneyParty.STORE,
      amount: new Prisma.Decimal('45.50'),
      ticketNumber: 'TK-2026-000043',
      staffId: 'staff-1',
    });
    expect(w.storeBalance('st-a')).toBe('459.50');
    expect(w.balance('s')).toBe('530.50');
    expect(w.accountTotal()).toBe(bookWas);
    expect(w.capital()).toBe(capitalWas);
    expect(w.held('s')).toBe(heldWas);
    expect(w.bankRows()).toBe(bankRowsWere);
    agrees(w);

    // And the CREDITS are untouched — a settlement corrects the figures
    // beside the payment, it never rewrites it.
    expect(w.creditsOf('r1')).toEqual(['SELLER CREDITED', 'STORE CREDITED']);
  });

  it('a correction that takes a wallet NEGATIVE is the group’s exposure, not our cash', async () => {
    // RS-7: the payer may go below zero (TRE-8c). What must not happen is
    // the bank book inventing an entry for money nobody holds — the
    // receivable is the seller's, and `held` is clamped at zero.
    const w = world([cod('r1', ON_PAYOUT, ON_PAYOUT)]);
    await deliver(w, 'r1');
    await w.pay('1180', [['r1', '1180']]);
    const bookWas = w.accountTotal();
    const bankRowsWere = w.bankRows();
    await w.resellerMoney.settleStoreDispute(w.tx as never, {
      storeId: 'st-a',
      sellerId: 's',
      orderId: 'r1',
      // More than the store holds: 385 − 500.
      payer: ResellerMoneyParty.STORE,
      amount: new Prisma.Decimal('500.00'),
      ticketNumber: 'TK-2026-000044',
      staffId: 'staff-1',
    });
    expect(w.storeBalance('st-a')).toBe('-115.00');
    expect(w.balance('s')).toBe('1105.00');
    // The group still owes 990 in total, so the book is unmoved — and
    // NOT ONE bank row was written. The store's debt to the seller is a
    // receivable inside the group; inventing a cash line for it would
    // put a number in the book no statement will ever agree with.
    expect(w.accountTotal()).toBe(bookWas);
    expect(w.bankRows()).toBe(bankRowsWere);
    expect(w.held('s')).toBe('990.00');
    agrees(w);
  });

  it('a change that moves nothing is a no-op, not a reversal', async () => {
    // A form round-trips every field it renders. Re-writing a credit
    // because somebody pressed save would show the seller and the store
    // a reversal and a re-credit for a change that never happened.
    const w = world([cod('r1', ON_PAYOUT, ON_PAYOUT)]);
    await deliver(w, 'r1');
    await w.pay('1180', [['r1', '1180']]);
    const out = await w.resellerMoney.recalculateAfterEdit('r1', { reason: 'Saved again' });
    expect(out.outcome).toBe('UNCHANGED');
    expect(w.storeEntriesOf('r1')).toEqual([
      'ORDER_CREDIT 480.00',
      'COD_TAX_SHARE 90.00',
      'FEE_SHARE 5.00',
    ]);
    agrees(w);
  });

  it('an order whose credits were never planned is left alone', async () => {
    const w = world([cod('r1', ON_PAYOUT, ON_PAYOUT)]);
    const out = await w.resellerMoney.recalculateAfterEdit('r1', { reason: 'Edited early' });
    // The plan is made at confirmation and will read the order as it now
    // stands, so there is nothing stale to correct.
    expect(out.outcome).toBe('NOT_PLANNED_YET');
    agrees(w);
  });

  it('two stores of one seller: each paid its own net, one pot in the book', async () => {
    const w = world([
      cod('r1', ON_PAYOUT, ON_PAYOUT),
      cod('r2', ON_PAYOUT, ON_PAYOUT, { storeId: 'st-b' }),
    ]);
    await deliver(w, 'r1');
    await deliver(w, 'r2');
    await w.pay('2360', [
      ['r1', '1180'],
      ['r2', '1180'],
    ]);
    expect(w.storeBalance('st-a')).toBe('385.00');
    expect(w.storeBalance('st-b')).toBe('385.00');
    expect(w.balance('s')).toBe('1210.00');
    expect(w.held('s')).toBe('1980.00');
    expect(w.accountTotal()).toBe('2360.00');
    agrees(w);
  });
});
