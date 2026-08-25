import { Controller, Get, HttpCode, HttpStatus, Param, Query, UseGuards } from '@nestjs/common';
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

  @Get(':sellerId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "One seller's wallet position" })
  detail(@Param('sellerId') sellerId: string): ReturnType<AdminSellerWalletService['detail']> {
    return this.svc.detail(sellerId);
  }

  @Get(':sellerId/entries')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "One seller's ledger, newest first" })
  async entries(
    @Param('sellerId') sellerId: string,
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
      orderBy: { createdAt: 'desc' },
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
    @Param('sellerId') sellerId: string,
    @Query('status') status?: TopupRequestStatus,
  ): ReturnType<WalletTopupService['listForSeller']> {
    return this.topups.listForSeller(sellerId, status);
  }

  @Get(':sellerId/withdrawals')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "One seller's payout requests" })
  sellerWithdrawals(
    @Param('sellerId') sellerId: string,
  ): ReturnType<WithdrawalRequestService['listForSeller']> {
    return this.withdrawals.listForSeller(sellerId);
  }
}
