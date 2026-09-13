import {
  Body,
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
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { WalletTransferDto } from '../dto/wallet-transfer.dto';
import {
  StaffWalletTransferService,
  type StaffTransferInput,
} from '../services/staff-wallet-transfer.service';

/**
 * A member of staff debiting or crediting a seller's wallet, with a reason
 * the seller reads. Every handler — reads included — sits behind
 * `money.wallet.transfer`: the page is only ever the place this is DONE,
 * and the context it reads (whose money is in which account) is part of
 * deciding to do it.
 */
@ApiTags('admin-wallet-transfer')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@RequirePermissions('money.wallet.transfer')
@Controller('admin/wallet-transfers')
export class AdminWalletTransferController {
  constructor(private readonly svc: StaffWalletTransferService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Past staff wallet transfers, newest first' })
  list(
    @Query('sellerId') sellerId?: string,
    @Query('limit') limit?: string,
  ): ReturnType<StaffWalletTransferService['list']> {
    return this.svc.list({
      ...(sellerId === undefined || sellerId === '' ? {} : { sellerId }),
      ...(limit === undefined ? {} : { limit: Number(limit) || 50 }),
    });
  }

  @Get('sellers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sellers whose wallet can be moved, by name or email' })
  sellers(@Query('q') q?: string): ReturnType<StaffWalletTransferService['searchSellers']> {
    return this.svc.searchSellers(q ?? '');
  }

  @Get('sellers/:sellerId/context')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "A seller's wallet and holdings, and every rupee account's capital and their share",
  })
  context(
    @Param('sellerId', new ParseUUIDPipe({ version: '7' })) sellerId: string,
  ): ReturnType<StaffWalletTransferService['context']> {
    return this.svc.context(sellerId);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'What a transfer would do — wallet and held cash before and after — writing nothing',
  })
  preview(
    @Body() body: WalletTransferDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): ReturnType<StaffWalletTransferService['preview']> {
    return this.svc.preview(toInput(body, staff.id));
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Debit or credit a seller's wallet. Cash moves with it (TRE-8); the reason is shown to the seller. Idempotent on idempotencyKey.",
  })
  execute(
    @Body() body: WalletTransferDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): ReturnType<StaffWalletTransferService['execute']> {
    return this.svc.execute(toInput(body, staff.id));
  }
}

function toInput(body: WalletTransferDto, staffId: string): StaffTransferInput {
  return {
    sellerId: body.sellerId,
    direction: body.direction,
    amountInr: body.amountInr,
    bankAccountId: body.bankAccountId ?? null,
    reason: body.reason,
    internalNote: body.internalNote ?? null,
    ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
    staffId,
  };
}
