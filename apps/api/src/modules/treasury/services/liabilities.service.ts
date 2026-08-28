import { Injectable } from '@nestjs/common';
import {
  Currency,
  InboundFreightStatus,
  Prisma,
  WalletEntryDirection,
  WithdrawalRequestStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

const ZERO = new Prisma.Decimal(0);

/**
 * The directions that can put a wallet in the red.
 *
 * Every one of them is money we spent or earned on the seller's behalf.
 * A remittance is deliberately absent: paying a seller what they asked
 * for cannot make them a debtor, and listing it as a cause of debt would
 * read as blaming them for being paid.
 */
const DEBT_CAUSES = [
  WalletEntryDirection.ORDER_CHARGES,
  WalletEntryDirection.RTO_FEE,
  WalletEntryDirection.INBOUND_FREIGHT,
  WalletEntryDirection.INSTANT_PAY_FEE,
  WalletEntryDirection.COD_COLLECTION_FEE,
  WalletEntryDirection.ADJUSTMENT_DEBIT,
] as const;

export interface LedgerLine {
  readonly key: string;
  readonly label: string;
  readonly amountInr: string;
  readonly count: number;
  /** What this is, and what happens if it is ignored. */
  readonly meaning: string;
}

export interface SellerDebt {
  readonly sellerId: string;
  readonly companyName: string;
  readonly owedInr: string;
  /** Value of their stock sitting in our warehouse, at cost. */
  readonly stockValueInr: string;
  readonly covered: boolean;
  /**
   * What the debt is FOR, since the balance last went below zero.
   *
   * A total tells you a seller owes ₹9,000; this tells you it is
   * ₹8,200 of inbound freight and ₹800 of delivery fees, which is the
   * difference between chasing them and understanding them. Freight on
   * stock that has not sold yet clears itself; delivery fees on
   * delivered orders do not.
   */
  readonly causes: ReadonlyArray<{ direction: string; amountInr: string }>;
}

export interface LiabilitiesReport {
  readonly owed: ReadonlyArray<LedgerLine>;
  readonly owedTotalInr: string;
  readonly due: ReadonlyArray<LedgerLine>;
  readonly dueTotalInr: string;
  readonly netInr: string;
  readonly sellerDebts: ReadonlyArray<SellerDebt>;
}

/**
 * What we owe, and what is owed to us.
 *
 * Kept apart from the P&L on purpose: profit is about a WINDOW, this is
 * about a MOMENT. A business can be profitable and unable to pay, and
 * the two reports answer different questions — one tells you whether the
 * model works, this one tells you whether you can meet Friday.
 *
 * Nothing here is netted into a single figure and left at that. A net of
 * zero made of ₹5,00,000 owed to sellers next week against ₹5,00,000 a
 * courier will settle in a month is not a business in balance, so every
 * line carries what it is and what happens if it is ignored.
 */
@Injectable()
export class LiabilitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async report(): Promise<LiabilitiesReport> {
    const [walletBalances, pendingWithdrawals, unfiledGst, outstandingFreight, courierFloat] =
      await Promise.all([
        this.prisma.client.sellerWalletBalance.findMany({
          where: { currency: Currency.INR },
          select: { sellerId: true, balance: true },
        }),
        this.prisma.client.withdrawalRequest.aggregate({
          where: {
            status: { in: [WithdrawalRequestStatus.PENDING, WithdrawalRequestStatus.APPROVED] },
          },
          _sum: { amountRequested: true },
          _count: { _all: true },
        }),
        this.prisma.client.gstWithholding.aggregate({
          where: { filedAt: null },
          _sum: { gstAmountInr: true },
          _count: { _all: true },
        }),
        this.prisma.client.inboundFreightCharge.findMany({
          where: {
            status: {
              in: [InboundFreightStatus.PENDING, InboundFreightStatus.PARTIALLY_SETTLED],
            },
          },
          select: { totalInr: true, amountSettledInr: true },
        }),
        this.codFloat(),
      ]);

    // A wallet balance is a liability when positive and a receivable
    // when negative. Summing them into one number would let a seller who
    // owes us cancel out a seller we owe — two different people, and
    // neither debt is settled by the other existing.
    let owedToSellers = ZERO;
    let owedBySellers = ZERO;
    const debtors: string[] = [];
    for (const b of walletBalances) {
      if (b.balance.greaterThan(0)) owedToSellers = owedToSellers.add(b.balance);
      else if (b.balance.lessThan(0)) {
        owedBySellers = owedBySellers.add(b.balance.abs());
        debtors.push(b.sellerId);
      }
    }

    const freightOutstanding = outstandingFreight.reduce(
      (acc, f) => acc.add(f.totalInr.sub(f.amountSettledInr)),
      ZERO,
    );

    const owed: LedgerLine[] = [
      {
        key: 'seller_wallets',
        label: 'Seller wallet balances',
        amountInr: owedToSellers.toFixed(2),
        count: walletBalances.filter((b) => b.balance.greaterThan(0)).length,
        meaning:
          'Money sellers can ask for. Withdrawable on request, so it must be held rather than worked with.',
      },
      {
        key: 'pending_withdrawals',
        label: 'Withdrawals requested',
        amountInr: (pendingWithdrawals._sum.amountRequested ?? ZERO).toFixed(2),
        count: pendingWithdrawals._count._all,
        meaning:
          'Already inside the wallet figure above, and already asked for. This is the part due soonest.',
      },
      {
        key: 'unfiled_gst',
        label: 'GST withheld, not yet filed',
        amountInr: (unfiledGst._sum.gstAmountInr ?? ZERO).toFixed(2),
        count: unfiledGst._count._all,
        meaning:
          'Collected on the government’s behalf and owed to them. It was never ours; spending it is spending a tax return.',
      },
    ];

    const due: LedgerLine[] = [
      {
        key: 'courier_float',
        label: 'COD collected, not yet settled',
        amountInr: courierFloat.amount.toFixed(2),
        count: courierFloat.count,
        meaning:
          'Cash the courier holds for delivered orders. Arrives on their cycle, not ours — the largest thing standing between profit and liquidity.',
      },
      {
        key: 'freight_outstanding',
        label: 'Inbound freight billed, not recovered',
        amountInr: freightOutstanding.toFixed(2),
        count: outstandingFreight.length,
        meaning:
          'Pay-later freight, recovered per unit as stock sells. Slow by design rather than overdue.',
      },
      {
        key: 'seller_debts',
        label: 'Sellers in the red',
        amountInr: owedBySellers.toFixed(2),
        count: debtors.length,
        meaning:
          'Wallets below zero — charges taken with nothing behind them. Backed by their stock in our warehouse, which is why it is a receivable and not a loss.',
      },
    ];

    const owedTotal = owed
      // The requested-withdrawals line is a SUBSET of the wallet
      // balances, not another debt. Adding it would count the same money
      // twice and overstate what we owe by whatever is in flight.
      .filter((l) => l.key !== 'pending_withdrawals')
      .reduce((acc, l) => acc.add(new Prisma.Decimal(l.amountInr)), ZERO);
    const dueTotal = due.reduce((acc, l) => acc.add(new Prisma.Decimal(l.amountInr)), ZERO);

    return {
      owed,
      owedTotalInr: owedTotal.toFixed(2),
      due,
      dueTotalInr: dueTotal.toFixed(2),
      netInr: dueTotal.sub(owedTotal).toFixed(2),
      sellerDebts: await this.debtsWithCover(debtors),
    };
  }

  /**
   * COD the courier is holding.
   *
   * Delivered, so the customer has paid; unsettled, so the money has not
   * reached us. `updatedAt` stands in for delivered-at — the exact scan
   * lives in the tracking hypertable and joining it would turn a finance
   * report into a scan.
   */
  private async codFloat(): Promise<{ amount: Prisma.Decimal; count: number }> {
    const rows = await this.prisma.client.order.findMany({
      where: {
        status: 'DELIVERED',
        codAmountInr: { gt: 0 },
        courierSettlementLines: { none: {} },
      },
      select: { codAmountInr: true },
    });
    return {
      amount: rows.reduce((acc, r) => acc.add(r.codAmountInr ?? ZERO), ZERO),
      count: rows.length,
    };
  }

  /**
   * A negative wallet, against the stock standing behind it.
   *
   * This is the whole reason a seller may go negative at all: their
   * goods are in our building. A debt covered by stock is a timing
   * problem — it clears as the stock sells — while an uncovered one is
   * money we may not see again, and only the second is worth acting on.
   * Valued at COST, never at what it might retail for; the optimistic
   * number is the one that makes a bad debt look fine.
   */
  private async debtsWithCover(sellerIds: string[]): Promise<SellerDebt[]> {
    if (sellerIds.length === 0) return [];

    const [sellers, balances, stock] = await Promise.all([
      this.prisma.client.seller.findMany({
        where: { id: { in: sellerIds } },
        select: { id: true, companyName: true },
      }),
      this.prisma.client.sellerWalletBalance.findMany({
        where: { sellerId: { in: sellerIds }, currency: Currency.INR },
        select: { sellerId: true, balance: true },
      }),
      this.prisma.client.stockLevel.findMany({
        where: { sellerId: { in: sellerIds }, qtyOnHand: { gt: 0 } },
        select: {
          sellerId: true,
          qtyOnHand: true,
          batch: { select: { unitCostInr: true } },
        },
      }),
    ]);

    const nameById = new Map(sellers.map((s) => [s.id, s.companyName]));
    const owedById = new Map(balances.map((b) => [b.sellerId, b.balance.abs()]));
    const stockById = new Map<string, Prisma.Decimal>();
    for (const level of stock) {
      // A batch with no recorded unit cost contributes NOTHING rather
      // than a guess. Treating unknown as zero understates the cover,
      // which errs toward chasing a debt that was already safe — the
      // harmless direction.
      const cost = level.batch?.unitCostInr ?? null;
      if (cost === null) continue;
      stockById.set(
        level.sellerId,
        (stockById.get(level.sellerId) ?? ZERO).add(cost.mul(level.qtyOnHand)),
      );
    }

    const causesById = new Map(
      await Promise.all(sellerIds.map(async (id) => [id, await this.causesOfDebt(id)] as const)),
    );

    return sellerIds
      .map((id) => {
        const owed = owedById.get(id) ?? ZERO;
        const cover = stockById.get(id) ?? ZERO;
        return {
          sellerId: id,
          companyName: nameById.get(id) ?? 'Unknown',
          owedInr: owed.toFixed(2),
          stockValueInr: cover.toFixed(2),
          covered: cover.greaterThanOrEqualTo(owed),
          causes: causesById.get(id) ?? [],
        };
      })
      .sort((a, b) => Number(b.owedInr) - Number(a.owedInr));
  }

  /**
   * What put this seller in the red, by cause.
   *
   * Read from the point their balance last stood at zero or above — not
   * over their whole history, which would list charges they have long
   * since paid for and make an old account look far worse than a new
   * one. Everything after that moment is what the current debt is
   * actually made of.
   *
   * Credits in that window are deliberately NOT netted off any
   * particular cause: a ₹500 top-up against ₹8,000 of freight and ₹800
   * of fees does not pay off one of them, and choosing which to reduce
   * would be inventing an allocation the seller never made.
   */
  private async causesOfDebt(
    sellerId: string,
  ): Promise<Array<{ direction: string; amountInr: string }>> {
    const lastSolvent = await this.prisma.client.sellerWalletEntry.findFirst({
      where: {
        sellerId,
        currency: Currency.INR,
        runningBalanceAfter: { gte: 0 },
      },
      orderBy: { id: 'desc' },
      select: { id: true },
    });

    const debits = await this.prisma.client.sellerWalletEntry.groupBy({
      by: ['direction'],
      where: {
        sellerId,
        currency: Currency.INR,
        ...(lastSolvent === null ? {} : { id: { gt: lastSolvent.id } }),
        direction: { in: [...DEBT_CAUSES] },
      },
      _sum: { amount: true },
    });

    return debits
      .map((d) => ({
        direction: d.direction,
        amountInr: (d._sum.amount ?? ZERO).toFixed(2),
      }))
      .filter((d) => Number(d.amountInr) > 0)
      .sort((a, b) => Number(b.amountInr) - Number(a.amountInr));
  }
}
