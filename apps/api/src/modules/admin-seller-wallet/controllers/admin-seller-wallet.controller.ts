import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Currency, TopupRequestStatus } from '@skydrop/db';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { WalletTopupService } from '../../wallet-topup/services/wallet-topup.service';
import { WithdrawalRequestService } from '../../seller-wallet-withdrawal/services/withdrawal-request.service';
import { AdminSellerWalletService } from '../services/admin-seller-wallet.service';

/**
 * Every seller's wallet, from our side.
 *
 * READ ONLY. Money moves through the paths that already own it — a page
 * that both reports balances and adjusts them is one where a mis-click
 * looks like a report.
 */
@ApiTags('admin-seller-wallet')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@RequirePermissions('money.view')
@Controller('admin/seller-wallets')
export class AdminSellerWalletController {
  constructor(
    private readonly svc: AdminSellerWalletService,
    private readonly prisma: PrismaService,
    private readonly topups: WalletTopupService,
    private readonly withdrawals: WithdrawalRequestService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Every seller wallet, with what we owe and what is owed to us' })
  overview(): ReturnType<AdminSellerWalletService['overview']> {
    return this.svc.overview();
  }

  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('money.wallets.reconcile')
  @ApiOperation({
    summary:
      'Re-check every wallet against its own ledger and repair the cached balance. Reports a ledger that does not add up; never corrects one, because that would destroy the evidence.',
  })
  reconcile(): ReturnType<AdminSellerWalletService['reconcile']> {
    return this.svc.reconcile();
  }

  @Get(':sellerId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "One seller's wallet position" })
  detail(
    @Param('sellerId', new ParseUUIDPipe({ version: '7' })) sellerId: string,
  ): ReturnType<AdminSellerWalletService['detail']> {
    return this.svc.detail(sellerId);
  }

  @Get(':sellerId/entries')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "One seller's ledger, newest first" })
  async entries(
    @Param('sellerId', new ParseUUIDPipe({ version: '7' })) sellerId: string,
    @Query('limit') limit?: string,
  ): Promise<{
    items: Array<{
      id: string;
      currency: Currency;
      direction: string;
      amount: string;
      runningBalanceAfter: string;
      linkedOrderId: string | null;
      reasonCode: string | null;
      note: string | null;
      createdAt: Date;
    }>;
  }> {
    const rows = await this.prisma.client.sellerWalletEntry.findMany({
      where: { sellerId },
      // By ID, not createdAt. Ordering on a column that is not unique
      // returns ties in arbitrary order, and this is the one screen
      // where somebody reads the running-balance column down the page —
      // a tie makes the balance look like it went backwards. Today the
      // timestamps happen not to tie (Prisma stamps each row itself),
      // but the column's DB default is CURRENT_TIMESTAMP, so that is a
      // property of the client rather than of the data. This is the one screen where
      // somebody reads the running-balance column down the page, and it
      // would appear to go backwards. uuidv7 ids are monotonic and
      // distinct within a transaction (WAL-7), which is why the balance
      // itself is derived from them.
      orderBy: { id: 'desc' },
      take: Math.min(500, Math.max(1, Number(limit) || 100)),
      select: {
        id: true,
        currency: true,
        direction: true,
        amount: true,
        runningBalanceAfter: true,
        linkedOrderId: true,
        reasonCode: true,
        note: true,
        createdAt: true,
      },
    });
    return {
      items: rows.map((r) => ({
        ...r,
        amount: r.amount.toFixed(2),
        runningBalanceAfter: r.runningBalanceAfter.toFixed(2),
      })),
    };
  }

  @Get(':sellerId/topups')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "One seller's top-up claims, whatever became of them" })
  sellerTopups(
    @Param('sellerId', new ParseUUIDPipe({ version: '7' })) sellerId: string,
    @Query('status') status?: TopupRequestStatus,
  ): ReturnType<WalletTopupService['listForSeller']> {
    return this.topups.listForSeller(sellerId, status);
  }

  @Get(':sellerId/withdrawals')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "One seller's withdrawal requests" })
  sellerWithdrawals(
    @Param('sellerId', new ParseUUIDPipe({ version: '7' })) sellerId: string,
  ): ReturnType<WithdrawalRequestService['listForSeller']> {
    return this.withdrawals.listForSeller(sellerId);
  }
}
