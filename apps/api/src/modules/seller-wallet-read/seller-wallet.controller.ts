import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Currency, WalletEntryDirection } from '@skydrop/db';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletService } from '../seller-wallet/services/wallet.service';
import { RequireSellerPermissions } from '../../common/auth/require-seller-permissions.decorator';

interface WalletBalanceView {
  readonly currency: Currency;
  readonly balance: string;
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
  ) {}

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Current balance per currency' })
  async balances(
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<{ balances: WalletBalanceView[] }> {
    const [inr, bdt] = await Promise.all([
      this.wallet.balanceCached(seller.id, Currency.INR),
      this.wallet.balanceCached(seller.id, Currency.BDT),
    ]);
    return {
      balances: [
        { currency: Currency.INR, balance: inr.toFixed(2) },
        { currency: Currency.BDT, balance: bdt.toFixed(2) },
      ],
    };
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
