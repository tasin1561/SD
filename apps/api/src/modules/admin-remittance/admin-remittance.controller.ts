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
import { Currency, StaffRole } from '@skydrop/db';
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { requireStaffRoles } from '../../common/auth/require-staff-roles';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../common/types/request';
import { WalletService } from '../seller-wallet/services/wallet.service';
import { CreateRemittanceDto } from './dto/create-remittance.dto';
import { RemittanceService } from './services/remittance.service';

@ApiTags('admin-remittances')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/remittances')
export class AdminRemittanceController {
  constructor(
    private readonly svc: RemittanceService,
    private readonly wallet: WalletService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Record a remittance — debits the seller wallet + audits',
  })
  create(
    @Body() body: CreateRemittanceDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ id: string }> {
    requireStaffRoles(staff, [StaffRole.SUPER_ADMIN, StaffRole.FINANCE]);
    return this.svc.create(body, { staffId: staff.id }, ctx);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List recorded remittances (most-recently-paid first)' })
  list(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Query('sellerId') sellerId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    requireStaffRoles(staff, [StaffRole.SUPER_ADMIN, StaffRole.FINANCE]);
    return this.svc.list({
      ...(sellerId ? { sellerId } : {}),
      ...(page ? { page: Number(page) } : {}),
      ...(pageSize ? { pageSize: Number(pageSize) } : {}),
    });
  }

  @Get('seller/:sellerId/balance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Wallet balances per currency for a seller (admin remittance form pre-fill)',
  })
  async sellerBalances(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('sellerId') sellerId: string,
  ): Promise<{ balances: Array<{ currency: Currency; balance: string }> }> {
    requireStaffRoles(staff, [StaffRole.SUPER_ADMIN, StaffRole.FINANCE]);
    const [inr, bdt] = await Promise.all([
      this.wallet.balanceCached(sellerId, Currency.INR),
      this.wallet.balanceCached(sellerId, Currency.BDT),
    ]);
    return {
      balances: [
        { currency: Currency.INR, balance: inr.toFixed(2) },
        { currency: Currency.BDT, balance: bdt.toFixed(2) },
      ],
    };
  }
}
