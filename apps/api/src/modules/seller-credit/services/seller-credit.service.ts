import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Currency, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';

const ZERO = new Prisma.Decimal(0);

export interface CreditStanding {
  readonly balanceInr: string;
  /** Cost value of their stock in our warehouses. Zero when unknown. */
  readonly stockValueInr: string;
  /** How far below zero this seller may go, all in. */
  readonly allowanceInr: string;
  /** allowance + balance. Negative means they are past it. */
  readonly headroomInr: string;
  readonly blocked: boolean;
  /** Plain-language, shown to the seller. Null when nothing is wrong. */
  readonly reason: string | null;
}

/**
 * How far into the red a seller may go, and what happens at the end of it.
 *
 * A wallet goes negative when charges land with nothing behind them — an
 * RTO fee on a seller who has not topped up, freight on stock that has
 * not sold. Some slack is CORRECT rather than merely tolerated: their
 * goods are in our warehouse, and the debt clears as those goods sell.
 *
 * What is not correct is unbounded slack. Every further order spends
 * money we are already owed, so past the allowance new orders are
 * refused. The block is at ORDER CREATE, deliberately: it is the last
 * point where nothing has been committed. Blocking at confirmation would
 * mean an agent discovering it mid-call with the customer on the line,
 * and blocking at dispatch would mean the goods are already picked.
 *
 * Resolution FAILS OPEN. A settings outage must not stop a working
 * seller from trading; the money at risk in the minutes before someone
 * notices is far smaller than the cost of the whole platform refusing
 * orders because one lookup failed.
 */
@Injectable()
export class SellerCreditService {
  private readonly logger = new Logger(SellerCreditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsResolverService,
  ) {}

  /**
   * Refuse a new order when the seller is past what we can carry.
   *
   * Deliberately NOT a `seller_restrictions` row. That table is for
   * deliberate staff holds — it demands a human author, it is one-active
   * per seller, and lifting it is somebody's decision. A credit block is
   * a COMPUTED state that corrects itself the moment a top-up lands or
   * stock sells, and persisting it would put the two in competition for
   * the same partial unique while adding a hold nobody applied.
   */
  async assertCanPlaceOrder(sellerId: string): Promise<void> {
    const standing = await this.standing(sellerId);
    if (!standing.blocked) return;
    throw new BadRequestException({
      code: 'WALLET_OVERDRAWN',
      message: standing.reason ?? 'This wallet is past the balance we can carry.',
      cause: {
        balanceInr: standing.balanceInr,
        allowanceInr: standing.allowanceInr,
        stockValueInr: standing.stockValueInr,
      },
    });
  }

  async standing(sellerId: string): Promise<CreditStanding> {
    const balanceRow = await this.prisma.client.sellerWalletBalance.findUnique({
      where: { sellerId_currency: { sellerId, currency: Currency.INR } },
      select: { balance: true },
    });
    const balance = balanceRow?.balance ?? ZERO;

    // In credit: nothing to compute, and no reason to price their stock.
    if (balance.greaterThanOrEqualTo(0)) {
      return {
        balanceInr: balance.toFixed(2),
        stockValueInr: '0.00',
        allowanceInr: '0.00',
        headroomInr: balance.toFixed(2),
        blocked: false,
        reason: null,
      };
    }

    let flat = ZERO;
    let stockBacked = true;
    try {
      const [limit, backed] = await Promise.all([
        this.settings.resolve(sellerId, 'wallet.negative_balance_limit_inr'),
        this.settings.resolve(sellerId, 'wallet.negative_balance_stock_backed'),
      ]);
      flat = new Prisma.Decimal(String(limit.value ?? '0'));
      stockBacked = backed.value !== false;
    } catch (err) {
      this.logger.error(
        { sellerId, err },
        'Could not resolve the credit settings; failing OPEN so trading continues.',
      );
      return {
        balanceInr: balance.toFixed(2),
        stockValueInr: '0.00',
        allowanceInr: '0.00',
        headroomInr: '0.00',
        blocked: false,
        reason: null,
      };
    }

    const stockValue = stockBacked ? await this.stockValue(sellerId) : ZERO;
    const allowance = flat.add(stockValue);
    const headroom = allowance.add(balance); // balance is negative here
    const blocked = headroom.lessThan(0);

    return {
      balanceInr: balance.toFixed(2),
      stockValueInr: stockValue.toFixed(2),
      allowanceInr: allowance.toFixed(2),
      headroomInr: headroom.toFixed(2),
      blocked,
      reason: blocked
        ? `Your wallet is ₹${balance.abs().toFixed(2)} overdrawn, past the ₹${allowance.toFixed(
            2,
          )} we can carry. Top up, or wait for stock to sell, and new orders will go through again.`
        : null,
    };
  }

  /**
   * What their stock is worth to us as security, at COST.
   *
   * Never at what it might retail for — the optimistic number is the one
   * that makes a bad debt look fine. A batch with no recorded cost
   * contributes NOTHING rather than a guess, which errs toward refusing
   * an order we could have taken: the recoverable direction.
   */
  private async stockValue(sellerId: string): Promise<Prisma.Decimal> {
    const levels = await this.prisma.client.stockLevel.findMany({
      where: { sellerId, qtyOnHand: { gt: 0 } },
      select: { qtyOnHand: true, batch: { select: { unitCostInr: true } } },
    });
    return levels.reduce((acc, l) => {
      const cost = l.batch?.unitCostInr ?? null;
      return cost === null ? acc : acc.add(cost.mul(l.qtyOnHand));
    }, ZERO);
  }
}
