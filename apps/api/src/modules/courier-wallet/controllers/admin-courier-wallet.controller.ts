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
import { CourierRechargeMatch } from '@skydrop/db';

import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { CourierWalletReadService } from '../services/courier-wallet-read.service';
import { CourierWalletRecordService } from '../services/courier-wallet-record.service';
import {
  ListRechargesQueryDto,
  RecordOutgoingRechargeDto,
  RecordRechargeBankSideDto,
  ResolveRechargeDto,
} from '../dto/courier-wallet.dto';

/**
 * The courier's prepaid wallet, against our own bank.
 *
 * Read is `money.treasury.view` and every write is
 * `money.treasury.manage` — this IS the treasury, sitting on somebody
 * else's system. A person who may not record a bank movement must not
 * be able to record one here by going through the courier's door.
 */
@ApiTags('admin-courier-wallet')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('money.treasury.view')
@Controller('admin/courier-wallet')
export class AdminCourierWalletController {
  constructor(
    private readonly read: CourierWalletReadService,
    private readonly record: CourierWalletRecordService,
  ) {}

  @Get('accounts')
  @ApiOperation({ summary: 'Each courier wallet, its last known balance and what is unreconciled' })
  async accounts(): Promise<{ accounts: unknown }> {
    return { accounts: await this.read.accounts() };
  }

  @Get('recharges')
  @ApiOperation({ summary: 'Recharges at the courier, and what of ours each is tied to' })
  async recharges(@Query() query: ListRechargesQueryDto): Promise<{ recharges: unknown }> {
    return {
      recharges: await this.read.recharges({
        ...(query.matchState === undefined
          ? {}
          : { matchState: CourierRechargeMatch[query.matchState] }),
        ...(query.courierAccountId === undefined
          ? {}
          : { courierAccountId: query.courierAccountId }),
      }),
    };
  }

  @Get('unmatched-payments')
  @ApiOperation({ summary: 'Money we booked as a recharge that the courier never showed' })
  async unmatched(): Promise<{ payments: unknown }> {
    return { payments: await this.read.unmatchedPayments() };
  }

  @Post('recharges/:id/record-bank-side')
  @RequirePermissions('money.treasury.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Say which of our accounts paid for this recharge; writes the entry' })
  async recordBankSide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordRechargeBankSideDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<{ bankEntryId: string }> {
    return this.record.recordBankSide({
      rechargeId: id,
      bankAccountId: dto.bankAccountId,
      staffId: staff.id,
      ...(dto.note === undefined ? {} : { note: dto.note }),
    });
  }

  @Post('recharges/:id/resolve')
  @RequirePermissions('money.treasury.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record that this recharge was not paid for by us, and why' })
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveRechargeDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<{ resolved: true }> {
    return this.record.resolveWithoutPayment({
      rechargeId: id,
      staffId: staff.id,
      reason: dto.reason,
    });
  }

  @Post('payments')
  @RequirePermissions('money.treasury.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a top-up we have just paid, before the courier shows it' })
  async recordPayment(
    @Body() dto: RecordOutgoingRechargeDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<{ bankEntryId: string }> {
    return this.record.recordOutgoingPayment({
      bankAccountId: dto.bankAccountId,
      courierAccountId: dto.courierAccountId,
      amountInr: dto.amountInr,
      occurredAt: new Date(dto.occurredAt),
      reference: dto.reference,
      staffId: staff.id,
      ...(dto.note === undefined ? {} : { note: dto.note }),
    });
  }
}
