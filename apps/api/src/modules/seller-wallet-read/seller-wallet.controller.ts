import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Currency, WalletEntryDirection } from '@skydrop/db';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import { FxRateService } from '../fx/services/fx-rate.service';
import { SettingsResolverService } from '../settings/services/settings-resolver.service';
import type { AuthenticatedSeller } from '../../common/types/request';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletService } from '../seller-wallet/services/wallet.service';
import { RequireSellerPermissions } from '../../common/auth/require-seller-permissions.decorator';

/**
 * The terms this seller's wallet runs on, in their words.
 *
 * READ ONLY, and there is no seller-facing writer anywhere — these are
 * set by us, globally or per seller (SET-1). A seller cannot raise their
 * own withdrawal cap or waive their own minimum balance, which is the
 * entire point of having them.
 *
 * Shown anyway, because every one of these decides an outcome the seller
 * experiences: how much they can take out, how often, when COD lands,
 * what is charged. A rule that only appears as a refusal is one they
 * have to discover by being refused.
 *
 * RESOLVED values (their override if they have one, else the default) —
 * an operator and a seller reading different numbers for the same rule
 * is how a support call starts.
 *
 * `wallet.settlement_shortfall_alert_percent` is deliberately NOT here.
 * It decides when OUR dispute with a courier gets escalated internally:
 * a payout short by more than that fraction audits CRITICAL instead of
 * MEDIUM. The seller is credited what the order was worth either way
 * (WAL-6), so the number changes nothing they experience — it would only
 * invite a question about a process they are not part of.
 */
const SELLER_WALLET_TERMS = [
  [
    'wallet.minimum_balance_inr',
    'Minimum balance',
    'INR',
    'Must stay in your wallet — it is not available to withdraw.',
  ],
  [
    'wallet.withdrawal_min_threshold_inr',
    'Smallest payout',
    'INR',
    'A request below this is refused.',
  ],
  [
    'wallet.withdrawal_max_per_day',
    'Payouts per day',
    'COUNT',
    'How often you can ask, not how much.',
  ],
  ['wallet.withdrawal_max_per_month', 'Payouts per month', 'COUNT', 'Rolling 30 days.'],
  [
    'wallet.auto_withdraw_enabled',
    'Automatic payouts',
    'BOOL',
    'We raise the request for you on a schedule.',
  ],
  ['wallet.auto_withdraw_hour_local', 'Automatic payout hour', 'HOUR', 'In your own timezone.'],
  [
    'wallet.cod_credit_mode',
    'COD credited',
    'TEXT',
    'On settlement when the courier pays us, or instantly at delivery.',
  ],
  [
    'wallet.instant_pay_fee_percent',
    'Instant-pay fee',
    'PERCENT',
    'Only if you are on instant COD credit.',
  ],
  [
    'wallet.cod_gst_percent',
    'GST withheld on COD',
    'PERCENT',
    'Taken out of the collected amount, not added on top. We file it.',
  ],
  ['wallet.cod_collection_fee_percent', 'COD collection fee', 'PERCENT', ''],
  [
    'wallet.courier_fee_deduction_timing',
    'Delivery fee charged',
    'TEXT',
    'When the AWB is made, or when the parcel is delivered.',
  ],
  [
    'wallet.inbound_freight_mode',
    'Inbound freight terms',
    'TEXT',
    'Paid on arrival, or spread over the units as they sell.',
  ],
  [
    'wallet.inbound_freight_service_charge_percent',
    'Pay-later service charge',
    'PERCENT',
    'Only applies to pay-as-it-sells freight.',
  ],
] as const;

interface WalletBalanceView {
  readonly currency: Currency;
  readonly balance: string;
  /**
   * True when this figure is the INR balance expressed in another
   * currency rather than a balance of its own. INR is canonical (every
   * entry is written in it); BDT is a VIEW of it at the current rate.
   *
   * Flagged rather than left to the reader, because the two are worth
   * very different things: a second balance is money you could withdraw
   * separately, a conversion is the same money counted again.
   */
  readonly isConverted: boolean;
  /** The rate used, when converted — so the figure can be checked. */
  readonly fxRate: string | null;
}

interface WalletEntryView {
  readonly id: string;
  readonly currency: Currency;
  readonly direction: WalletEntryDirection;
  readonly amount: string;
  readonly runningBalanceAfter: string;
  readonly linkedOrderId: string | null;
  readonly linkedRemittanceId: string | null;
  /**
   * Present on an INBOUND_FREIGHT debit, resolved from the freight
   * charge's UNIQUE walletEntryId. Freight belongs to a consignment
   * rather than an order, so without this the Linked column was empty on
   * the one entry type where the seller most needs to see what they were
   * charged for.
   */
  readonly linkedConsignmentId: string | null;
  readonly linkedConsignmentNumber: string | null;
  readonly reasonCode: string | null;
  readonly note: string | null;
  readonly createdAt: string;
}

interface WalletEntriesPage {
  readonly items: ReadonlyArray<WalletEntryView>;
  readonly nextCursor: string | null;
}

/**
 * Phase 1B M24 — seller wallet read endpoints.
 *
 * `/seller/wallet` returns the current balance per Currency (always
 * INR + BDT; zero if no entries). `/seller/wallet/entries` returns
 * a paginated ledger (cursor-based on createdAt for deterministic
 * ordering even with hot writes).
 *
 * SellerAuthAllowSuspended on both — a suspended seller can still
 * see what's owed to them, they just can't trigger new business
 * actions.
 */
@ApiTags('seller-wallet')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('wallet.view')
@Controller('seller/wallet')
export class SellerWalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly prisma: PrismaService,
    private readonly fx: FxRateService,
    private readonly settings: SettingsResolverService,
  ) {}

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Current balance per currency' })
  async balances(
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<{ balances: WalletBalanceView[] }> {
    const inr = await this.wallet.balanceCached(seller.id, Currency.INR);

    // BDT is a CONVERSION of the INR balance, not a second wallet.
    //
    // It used to read the BDT ledger, which is always empty — every
    // entry the system writes is INR — so a Bangladeshi seller saw
    // "৳0.00, no activity yet" next to what they were actually owed.
    // That is a true statement about a pot nobody uses, and a useless
    // one about their money.
    //
    // A missing rate yields null rather than zero. Zero is a number a
    // seller would act on; "we cannot convert right now" is the truth.
    let bdt: { balance: string; rate: string } | null = null;
    try {
      const converted = await this.fx.convert({
        amount: inr.toFixed(2),
        from: Currency.INR,
        to: Currency.BDT,
      });
      bdt = { balance: converted.amount, rate: converted.rate };
    } catch {
      bdt = null;
    }

    return {
      balances: [
        { currency: Currency.INR, balance: inr.toFixed(2), isConverted: false, fxRate: null },
        ...(bdt === null
          ? []
          : [
              {
                currency: Currency.BDT,
                balance: bdt.balance,
                isConverted: true,
                fxRate: bdt.rate,
              },
            ]),
      ],
    };
  }

  @Get('settings')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'The terms this wallet runs on. Read-only — sellers cannot change them.',
  })
  async terms(@CurrentSeller() seller: AuthenticatedSeller): Promise<{
    items: Array<{ key: string; label: string; kind: string; hint: string; value: string }>;
  }> {
    const items = await Promise.all(
      SELLER_WALLET_TERMS.map(async ([key, label, kind, hint]) => {
        try {
          const r = await this.settings.resolve(seller.id, key);
          return { key, label, kind, hint, value: String(r.value ?? '') };
        } catch {
          // Unknown rather than defaulted: showing a seller a number we
          // did not read is worse than showing them nothing.
          return { key, label, kind, hint, value: '' };
        }
      }),
    );
    return { items };
  }

  @Get('entries')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Paginated ledger (newest first)' })
  async entries(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query('currency') currency?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<WalletEntriesPage> {
    const lim = Math.min(200, Math.max(1, Number(limit) || 50));
    const where: { sellerId: string; currency?: Currency; createdAt?: { lt: Date } } = {
      sellerId: seller.id,
    };
    if (currency === Currency.INR || currency === Currency.BDT) {
      where.currency = currency;
    }
    if (cursor) {
      const cursorDate = new Date(cursor);
      if (!Number.isNaN(cursorDate.getTime())) {
        where.createdAt = { lt: cursorDate };
      }
    }
    const rows = await this.prisma.client.sellerWalletEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: lim + 1,
      select: {
        id: true,
        currency: true,
        direction: true,
        amount: true,
        runningBalanceAfter: true,
        linkedOrderId: true,
        linkedRemittanceId: true,
        reasonCode: true,
        note: true,
        createdAt: true,
      },
    });
    const hasMore = rows.length > lim;
    const page = hasMore ? rows.slice(0, lim) : rows;

    // An INBOUND_FREIGHT debit has no linkedOrderId — it belongs to a
    // consignment, not an order — so the Linked column had nothing to
    // show and the seller could read "you were charged ₹3,000" with no
    // way to reach what they were charged FOR.
    //
    // Resolved by REVERSE LOOKUP rather than a new column:
    // `inbound_freight_charges.wallet_entry_id` is already UNIQUE (it is
    // the charged-exactly-once evidence), so it answers this without
    // widening the ledger. The ledger stays append-only and unchanged.
    const freightEntryIds = page
      .filter((r) => r.direction === WalletEntryDirection.INBOUND_FREIGHT)
      .map((r) => r.id);
    const freightByEntry = new Map<string, { id: string; number: string }>();
    if (freightEntryIds.length > 0) {
      const charges = await this.prisma.client.inboundFreightCharge.findMany({
        where: { walletEntryId: { in: freightEntryIds } },
        select: {
          walletEntryId: true,
          consignmentId: true,
          consignment: { select: { consignmentNumber: true } },
        },
      });
      for (const c of charges) {
        if (c.walletEntryId === null) continue;
        freightByEntry.set(c.walletEntryId, {
          id: c.consignmentId,
          number: c.consignment.consignmentNumber,
        });
      }
    }

    const items = page.map((r) => {
      const freight = freightByEntry.get(r.id) ?? null;
      return {
        id: r.id,
        currency: r.currency,
        direction: r.direction,
        amount: r.amount.toFixed(2),
        runningBalanceAfter: r.runningBalanceAfter.toFixed(2),
        linkedOrderId: r.linkedOrderId,
        linkedRemittanceId: r.linkedRemittanceId,
        linkedConsignmentId: freight?.id ?? null,
        linkedConsignmentNumber: freight?.number ?? null,
        reasonCode: r.reasonCode,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      };
    });
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.createdAt ?? null) : null,
    };
  }
}
