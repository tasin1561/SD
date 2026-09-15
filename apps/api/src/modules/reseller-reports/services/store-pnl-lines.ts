import type { StoreExpenseCategory } from '@skydrop/db';
import { Prisma, StoreWalletEntryDirection, WalletEntryDirection } from '@skydrop/db';

/**
 * A reseller store's P&L (RS-8), with no database in it.
 *
 * ── WHAT IT READS ────────────────────────────────────────────────────
 * The store's OWN wallet ledger (`store_wallet_entries`, append-only), by
 * DIRECTION, plus the order snapshot for the one figure no ledger holds
 * (the retail a store collected itself on a PREPAID order), plus the
 * store's own expense book. It never computes a fee share, a transfer
 * price or a COD tax figure: those are what phase 3c POSTS, and this
 * reports what was posted. A store whose money is posted differently
 * next year is reported correctly without a change here, as long as each
 * posting carries its direction.
 *
 * ── HOW IT TILES ─────────────────────────────────────────────────────
 * Every ledger row is dated by its `created_at` (the instant it was
 * written — never re-dated) and every expense by its Indian calendar day,
 * inside a HALF-OPEN window `[from, to)`. Each line's figure is the SUM
 * of its rows, computed here in one place, so a line and its drill-down
 * cannot disagree, and two adjacent windows add up to the window over
 * both. Every row carries the STABLE id of the record behind it (a
 * wallet entry or an expense), which is what lets a closed month be
 * frozen and compared later (the carry-forward, `store-pnl-carry-forward.ts`).
 */

const ZERO = new Prisma.Decimal(0);
const IST_OFFSET_MS = 330 * 60_000;

export const STORE_PNL_LINE_KEYS = [
  'order_margin',
  'prepaid_sales',
  'prepaid_cost',
  'fee_shares',
  'return_fees',
  'cod_tax_share',
  'expenses',
] as const;

export type StorePnlLineKey = (typeof STORE_PNL_LINE_KEYS)[number];
export type StorePnlSide = 'revenue' | 'cost';

/** Each line's name, side and what it holds. A Record, so a new key fails to compile until named. */
export const STORE_PNL_LINES: Record<
  StorePnlLineKey,
  { readonly label: string; readonly side: StorePnlSide; readonly note: string }
> = {
  order_margin: {
    label: 'Order credits',
    side: 'revenue',
    note: 'What your COD orders credited to your wallet — the retail you sold at less the seller’s transfer price — net of any credit taken back when a parcel returned or was lost.',
  },
  prepaid_sales: {
    label: 'Prepaid sales (collected by you)',
    side: 'revenue',
    note: 'The retail of prepaid orders, which you collected from the customer yourself. Counted when the order was paid for from your wallet; taken back if that payment was refunded.',
  },
  prepaid_cost: {
    label: 'Paid for prepaid orders',
    side: 'cost',
    note: 'What your wallet paid for prepaid orders — the transfer price plus your share of Skydrop’s fees — net of refunds.',
  },
  fee_shares: {
    label: 'Your share of Skydrop fees',
    side: 'cost',
    note: 'Your share of the delivery fee, COD fee and Instant Pay fee, as the seller’s terms split them, net of any share given back.',
  },
  return_fees: {
    label: 'Your share of return fees',
    side: 'cost',
    note: 'Your share of the fee for a parcel coming back, and of a customer return, net of any share given back.',
  },
  cod_tax_share: {
    label: 'Your share of the COD tax',
    side: 'cost',
    note: 'Your share of the tax deducted from cash-on-delivery money, net of any given back.',
  },
  expenses: {
    label: 'Your expenses',
    side: 'cost',
    note: 'What you recorded spending — ads, staff, software and the rest. Your own books: no money moves.',
  },
};

export const EXPENSE_CATEGORY_LABELS: Record<StoreExpenseCategory, string> = {
  AD_SPEND: 'Advertising',
  STAFF: 'Staff',
  SOFTWARE: 'Software',
  PHOTOGRAPHY: 'Photography',
  PACKAGING: 'Packaging',
  CUSTOMER_REFUNDS: 'Customer refunds',
  RENT: 'Rent',
  OTHER: 'Other',
};

// ── Inputs ───────────────────────────────────────────────────────────

export interface LedgerEntryIn {
  readonly id: string;
  readonly direction: StoreWalletEntryDirection;
  readonly amount: Prisma.Decimal;
  readonly shareOf: WalletEntryDirection | null;
  readonly linkedOrderId: string | null;
  readonly linkedEntryId: string | null;
  readonly createdAt: Date;
}

/** The entry a SHARE_REFUND names — it may sit outside the window. */
export interface LinkedEntryIn {
  readonly id: string;
  readonly direction: StoreWalletEntryDirection;
  readonly shareOf: WalletEntryDirection | null;
}

/** The order snapshot, for naming a row and for the retail a prepaid order carried. */
export interface OrderSnapshotIn {
  readonly id: string;
  readonly orderNumber: string;
  /** Σ retail × qty as placed (RS-5 snapshot). */
  readonly retailInr: Prisma.Decimal;
  /** Σ transfer price × qty as placed. */
  readonly transferInr: Prisma.Decimal;
}

export interface ExpenseIn {
  readonly id: string;
  readonly category: StoreExpenseCategory;
  readonly amountInr: Prisma.Decimal;
  /** A `@db.Date`: UTC midnight of the Indian calendar day. */
  readonly expenseDate: Date;
  readonly description: string;
}

// ── Output ───────────────────────────────────────────────────────────

export interface StorePnlRow {
  /** The record's STABLE id — a wallet entry or an expense. */
  readonly id: string;
  readonly ref: string;
  readonly subRef: string | null;
  /** ISO instant the row is dated by. */
  readonly at: string;
  /** In the line's own sense: more revenue on a revenue line, more cost on a cost line. */
  readonly amountInr: string;
  /** Snapshot context for an order row (retail and transfer as placed) — context, never summed. */
  readonly context?: { readonly retailInr: string; readonly transferInr: string };
}

export interface StorePnlLine {
  readonly key: StorePnlLineKey;
  readonly label: string;
  readonly side: StorePnlSide;
  readonly note: string;
  readonly amountInr: string;
  readonly count: number;
  readonly rows: readonly StorePnlRow[];
}

export interface StorePnlCash {
  /** Money the store put in (Skydrop-managed top-ups + the seller's top-ups). */
  readonly inInr: string;
  /** Money the store took out (withdrawals + payouts the seller recorded). */
  readonly outInr: string;
  readonly byDirection: ReadonlyArray<{
    readonly direction: StoreWalletEntryDirection;
    readonly amountInr: string;
    readonly count: number;
  }>;
}

export interface StorePnlReport {
  readonly from: string;
  readonly to: string;
  readonly lines: readonly StorePnlLine[];
  readonly revenueInr: string;
  readonly costInr: string;
  readonly netInr: string;
  readonly expensesByCategory: ReadonlyArray<{
    readonly category: StoreExpenseCategory;
    readonly label: string;
    readonly amountInr: string;
  }>;
  /** Top-ups and withdrawals: real cash, not profit or loss. */
  readonly cash: StorePnlCash;
  readonly warnings: readonly string[];
}

// ── Where each direction goes ────────────────────────────────────────

type Placement =
  | { readonly kind: 'line'; readonly line: StorePnlLineKey; readonly sign: 1 | -1 }
  | { readonly kind: 'prepaid'; readonly sign: 1 | -1 }
  | { readonly kind: 'cash'; readonly way: 'in' | 'out' };

/** A share of one Skydrop fee: a return fee has its own line. */
function feeLine(shareOf: WalletEntryDirection | null): StorePnlLineKey {
  switch (shareOf) {
    case WalletEntryDirection.RTO_FEE:
    case WalletEntryDirection.CUSTOMER_RETURN_FEE:
      return 'return_fees';
    case WalletEntryDirection.GST_WITHHOLDING:
      return 'cod_tax_share';
    default:
      return 'fee_shares';
  }
}

/**
 * Which line a SHARE_REFUND comes off: the line of the share it gives
 * back, read through the entry its `linked_entry_id` names (the P&L's own
 * rule for a returned deduction), falling back to its own `share_of`.
 */
function refundLine(entry: LedgerEntryIn, linked: LinkedEntryIn | undefined): StorePnlLineKey {
  if (linked !== undefined) {
    if (linked.direction === StoreWalletEntryDirection.COD_TAX_SHARE) return 'cod_tax_share';
    if (linked.direction === StoreWalletEntryDirection.FEE_SHARE) return feeLine(linked.shareOf);
  }
  return feeLine(entry.shareOf);
}

/**
 * Every store wallet direction, placed exactly once — F2-exhaustive, so a
 * direction added to the enum fails to compile until somebody decides
 * whether it is profit, loss or cash.
 */
export function placeDirection(entry: LedgerEntryIn, linked: LinkedEntryIn | undefined): Placement {
  const d = entry.direction;
  switch (d) {
    case StoreWalletEntryDirection.ORDER_CREDIT:
      return { kind: 'line', line: 'order_margin', sign: 1 };
    case StoreWalletEntryDirection.ORDER_CREDIT_REVERSAL:
      return { kind: 'line', line: 'order_margin', sign: -1 };
    case StoreWalletEntryDirection.FEE_SHARE:
      return { kind: 'line', line: feeLine(entry.shareOf), sign: 1 };
    case StoreWalletEntryDirection.COD_TAX_SHARE:
      return { kind: 'line', line: 'cod_tax_share', sign: 1 };
    case StoreWalletEntryDirection.SHARE_REFUND:
      return { kind: 'line', line: refundLine(entry, linked), sign: -1 };
    case StoreWalletEntryDirection.PREPAID_DEBIT:
      return { kind: 'prepaid', sign: 1 };
    case StoreWalletEntryDirection.PREPAID_REFUND:
      return { kind: 'prepaid', sign: -1 };
    case StoreWalletEntryDirection.TOPUP:
    case StoreWalletEntryDirection.SELLER_TOPUP:
      return { kind: 'cash', way: 'in' };
    case StoreWalletEntryDirection.WITHDRAWAL:
    case StoreWalletEntryDirection.SELLER_PAYOUT:
      return { kind: 'cash', way: 'out' };
    default: {
      const unplaced: never = d;
      return unplaced;
    }
  }
}

/** The instant an expense is dated by: 00:00 IST on its day. */
export function expenseInstant(expenseDate: Date): Date {
  return new Date(expenseDate.getTime() - IST_OFFSET_MS);
}

const WORDS: Record<StoreWalletEntryDirection, string> = {
  ORDER_CREDIT: 'Credited',
  ORDER_CREDIT_REVERSAL: 'Credit taken back',
  FEE_SHARE: 'Fee share',
  COD_TAX_SHARE: 'COD tax share',
  SHARE_REFUND: 'Share given back',
  PREPAID_DEBIT: 'Paid from wallet',
  PREPAID_REFUND: 'Refunded to wallet',
  TOPUP: 'Top-up',
  SELLER_TOPUP: 'Top-up from the seller',
  WITHDRAWAL: 'Withdrawal',
  SELLER_PAYOUT: 'Payout recorded by the seller',
};

const FEE_WORDS: Partial<Record<WalletEntryDirection, string>> = {
  ORDER_CHARGES: 'delivery fee',
  RTO_FEE: 'return fee',
  CUSTOMER_RETURN_FEE: 'customer return fee',
  COD_COLLECTION_FEE: 'COD fee',
  INSTANT_PAY_FEE: 'Instant Pay fee',
  GST_WITHHOLDING: 'COD tax',
};

function subRefFor(entry: LedgerEntryIn): string {
  const base = WORDS[entry.direction];
  const fee = entry.shareOf === null ? undefined : FEE_WORDS[entry.shareOf];
  return fee === undefined ? base : `${base} — ${fee}`;
}

/**
 * THE computation. Entries and expenses must already be the ones in the
 * window; this places each, sums each line from its rows, and says what
 * it could not do rather than guessing.
 */
export function buildStorePnl(input: {
  readonly from: Date;
  readonly to: Date;
  readonly entries: readonly LedgerEntryIn[];
  readonly linked: ReadonlyMap<string, LinkedEntryIn>;
  readonly orders: ReadonlyMap<string, OrderSnapshotIn>;
  readonly expenses: readonly ExpenseIn[];
}): StorePnlReport {
  const rows = new Map<StorePnlLineKey, StorePnlRow[]>(STORE_PNL_LINE_KEYS.map((k) => [k, []]));
  const push = (line: StorePnlLineKey, row: StorePnlRow): void => {
    (rows.get(line) ?? []).push(row);
  };
  const warnings: string[] = [];
  const cash = new Map<StoreWalletEntryDirection, { amount: Prisma.Decimal; count: number }>();
  let cashIn = ZERO;
  let cashOut = ZERO;

  for (const e of input.entries) {
    const order = e.linkedOrderId === null ? undefined : input.orders.get(e.linkedOrderId);
    const ref = order?.orderNumber ?? (e.linkedOrderId === null ? 'No order' : 'Order');
    const context =
      order === undefined
        ? undefined
        : { retailInr: order.retailInr.toFixed(2), transferInr: order.transferInr.toFixed(2) };
    const place = placeDirection(
      e,
      e.linkedEntryId === null ? undefined : input.linked.get(e.linkedEntryId),
    );
    const at = e.createdAt.toISOString();
    if (place.kind === 'cash') {
      const c = cash.get(e.direction) ?? { amount: ZERO, count: 0 };
      cash.set(e.direction, { amount: c.amount.add(e.amount), count: c.count + 1 });
      if (place.way === 'in') cashIn = cashIn.add(e.amount);
      else cashOut = cashOut.add(e.amount);
      continue;
    }
    if (place.kind === 'line') {
      push(place.line, {
        id: e.id,
        ref,
        subRef: subRefFor(e),
        at,
        amountInr: e.amount.mul(place.sign).toFixed(2),
        ...(context === undefined ? {} : { context }),
      });
      continue;
    }
    // Prepaid: the wallet side is the entry; the sale is the order's
    // retail, which only the snapshot knows.
    push('prepaid_cost', {
      id: e.id,
      ref,
      subRef: subRefFor(e),
      at,
      amountInr: e.amount.mul(place.sign).toFixed(2),
      ...(context === undefined ? {} : { context }),
    });
    if (order === undefined) {
      warnings.push(
        `A prepaid wallet entry (${e.id}) names an order that could not be read, so its retail is not counted as a sale.`,
      );
    } else {
      push('prepaid_sales', {
        id: e.id,
        ref,
        subRef: place.sign === 1 ? 'Sold (prepaid)' : 'Sale refunded',
        at,
        amountInr: order.retailInr.mul(place.sign).toFixed(2),
        context: {
          retailInr: order.retailInr.toFixed(2),
          transferInr: order.transferInr.toFixed(2),
        },
      });
    }
  }

  const byCategory = new Map<StoreExpenseCategory, Prisma.Decimal>();
  for (const x of input.expenses) {
    push('expenses', {
      id: x.id,
      ref: EXPENSE_CATEGORY_LABELS[x.category],
      subRef: x.description,
      at: expenseInstant(x.expenseDate).toISOString(),
      amountInr: x.amountInr.toFixed(2),
    });
    byCategory.set(x.category, (byCategory.get(x.category) ?? ZERO).add(x.amountInr));
  }

  const lines: StorePnlLine[] = STORE_PNL_LINE_KEYS.map((key) => {
    const list = (rows.get(key) ?? []).sort(
      (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
    );
    const amount = list.reduce((t, r) => t.add(r.amountInr), ZERO);
    const def = STORE_PNL_LINES[key];
    return {
      key,
      label: def.label,
      side: def.side,
      note: def.note,
      amountInr: amount.toFixed(2),
      count: list.length,
      rows: list,
    };
  });
  const revenue = lines
    .filter((l) => l.side === 'revenue')
    .reduce((t, l) => t.add(l.amountInr), ZERO);
  const cost = lines.filter((l) => l.side === 'cost').reduce((t, l) => t.add(l.amountInr), ZERO);

  return {
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    lines,
    revenueInr: revenue.toFixed(2),
    costInr: cost.toFixed(2),
    netInr: revenue.sub(cost).toFixed(2),
    expensesByCategory: [...byCategory]
      .map(([category, amount]) => ({
        category,
        label: EXPENSE_CATEGORY_LABELS[category],
        amountInr: amount.toFixed(2),
      }))
      .sort((a, b) => new Prisma.Decimal(b.amountInr).cmp(a.amountInr)),
    cash: {
      inInr: cashIn.toFixed(2),
      outInr: cashOut.toFixed(2),
      byDirection: [...cash].map(([direction, c]) => ({
        direction,
        amountInr: c.amount.toFixed(2),
        count: c.count,
      })),
    },
    warnings,
  };
}

/** A line's contribution to NET: revenue adds, cost subtracts. */
export function netContribution(line: StorePnlLineKey, amount: Prisma.Decimal): Prisma.Decimal {
  return STORE_PNL_LINES[line].side === 'revenue' ? amount : amount.negated();
}
