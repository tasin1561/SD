import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Currency } from '@skydrop/db';
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../common/types/request';
import { FxRateService } from '../fx/services/fx-rate.service';
import { WalletService } from '../seller-wallet/services/wallet.service';
import { CreateRemittanceDto } from './dto/create-remittance.dto';
import { RemittanceService } from './services/remittance.service';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';

@ApiTags('admin-remittances')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('money.view')
@Controller('admin/remittances')
export class AdminRemittanceController {
  constructor(
    private readonly svc: RemittanceService,
    private readonly wallet: WalletService,
    private readonly fx: FxRateService,
  ) {}

  @Post()
  @RequirePermissions('money.remittances.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Record a remittance — debits the seller wallet + audits',
  })
  create(
    @Body() body: CreateRemittanceDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ id: string }> {
    return this.svc.create(body, { staffId: staff.id }, ctx);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List recorded remittances (most-recently-paid first)' })
  list(
    @Query('sellerId') sellerId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.list({
      ...(sellerId ? { sellerId } : {}),
      ...(page ? { page: Number(page) } : {}),
      ...(pageSize ? { pageSize: Number(pageSize) } : {}),
    });
  }

  @Get('seller/:sellerId/balance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Wallet balances per currency for a seller (admin remittance form pre-fill)',
  })
  async sellerBalances(@Param('sellerId') sellerId: string): Promise<{
    balances: Array<{
      currency: Currency;
      balance: string;
      isConverted: boolean;
      fxRate: string | null;
    }>;
  }> {
    const inr = await this.wallet.balanceCached(sellerId, Currency.INR);

    // INR is the wallet; BDT is that same money in taka.
    //
    // This used to read the BDT ledger, which is always empty, so the
    // remittance form offered a BDT source pot holding ৳0 — a choice
    // that could never be taken. The converted figure answers the
    // question an operator actually has: what is this seller worth in
    // the currency we are about to wire?
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
}
