import {
  BadRequestException,
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
import { TopupRequestStatus, WithdrawalRequestStatus } from '@skydrop/db';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import {
  PayStoreWithdrawalDto,
  StoreTopupAcceptDto,
  StoreWalletLedgerQueryDto,
  StoreWalletRejectDto,
} from '../dto/reseller-store-wallet.dto';
import { StoreTopupService, type StoreTopupView } from '../services/store-topup.service';
import {
  StoreWalletService,
  type StoreWalletLedger,
  type StoreWalletSummary,
} from '../services/store-wallet.service';
import {
  StoreWithdrawalService,
  type StoreWithdrawalView,
} from '../services/store-withdrawal.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reseller store wallets from our side (RS-6): any store's ledger, and the
 * two queues a SKYDROP-managed store feeds — top-up claims and withdrawal
 * requests.
 *
 * Deliberately the SAME permissions as the seller money queues rather than
 * new keys: the people who accept a seller's top-up, resolve a seller's
 * withdrawal and record a remittance are the people who should do the same
 * for a store, and a new key reaches no role that already exists. Reading
 * is `money.view`; accepting or rejecting a claim `money.topups.review`;
 * approving or rejecting a withdrawal `money.withdrawals.review`; recording
 * the payout — the only thing that pays anyone — `money.remittances.manage`.
 */
@ApiTags('admin-reseller-store-wallets')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('money.view')
@Controller('admin/reseller-store-wallets')
export class AdminStoreWalletController {
  constructor(
    private readonly wallet: StoreWalletService,
    private readonly topups: StoreTopupService,
    private readonly withdrawals: StoreWithdrawalService,
  ) {}

  @Get('stores/:storeId')
  @ApiOperation({ summary: 'One reseller store’s wallet: balance, limit, pending' })
  summary(
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
  ): Promise<StoreWalletSummary> {
    return this.wallet.summary({ storeId });
  }

  @Get('stores/:storeId/entries')
  @ApiOperation({ summary: 'One reseller store’s wallet ledger, newest first' })
  entries(
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Query() q: StoreWalletLedgerQueryDto,
  ): Promise<StoreWalletLedger> {
    return this.wallet.ledger(
      { storeId },
      { ...(q.before === undefined ? {} : { before: q.before }), limit: q.limit ?? 50 },
    );
  }

  @Get('topups')
  @ApiOperation({ summary: 'Store top-up claims (filter by status and store)' })
  listTopups(
    @Query('status') status?: string,
    @Query('storeId') storeId?: string,
  ): Promise<readonly StoreTopupView[]> {
    return this.topups.listForAdmin({
      ...oneOf('status', status, Object.values(TopupRequestStatus)),
      ...uuid('storeId', storeId),
    });
  }

  @Get('topups/:topupId/proof')
  @ApiOperation({ summary: 'A short-lived link to a claim’s proof' })
  proof(@Param('topupId', new ParseUUIDPipe()) topupId: string): Promise<{ url: string }> {
    return this.topups.proofUrl(topupId, null);
  }

  @Post('topups/:topupId/accept')
  @RequirePermissions('money.topups.review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The money arrived: credit the store (as the seller’s cash)' })
  acceptTopup(
    @Param('topupId', new ParseUUIDPipe()) topupId: string,
    @Body() body: StoreTopupAcceptDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<StoreTopupView> {
    return this.topups.accept(topupId, staff.id, body.note ?? null);
  }

  @Post('topups/:topupId/reject')
  @RequirePermissions('money.topups.review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The money is not on the statement' })
  rejectTopup(
    @Param('topupId', new ParseUUIDPipe()) topupId: string,
    @Body() body: StoreWalletRejectDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<StoreTopupView> {
    return this.topups.reject(topupId, staff.id, body.reason);
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'Store withdrawal requests (filter by status and store)' })
  listWithdrawals(
    @Query('status') status?: string,
    @Query('storeId') storeId?: string,
  ): Promise<readonly StoreWithdrawalView[]> {
    return this.withdrawals.listForAdmin({
      ...oneOf('status', status, Object.values(WithdrawalRequestStatus)),
      ...uuid('storeId', storeId),
    });
  }

  @Post('withdrawals/:requestId/approve')
  @RequirePermissions('money.withdrawals.review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a store withdrawal (re-checked against the balance)' })
  approveWithdrawal(
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<StoreWithdrawalView> {
    return this.withdrawals.approve(requestId, staff.id);
  }

  @Post('withdrawals/:requestId/reject')
  @RequirePermissions('money.withdrawals.review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refuse a store withdrawal, with a reason the store reads' })
  rejectWithdrawal(
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Body() body: StoreWalletRejectDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<StoreWithdrawalView> {
    return this.withdrawals.reject(requestId, staff.id, body.reason);
  }

  @Post('withdrawals/:requestId/pay')
  @RequirePermissions('money.remittances.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record the payout — the store is paid (HIGH audit)' })
  payWithdrawal(
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Body() body: PayStoreWithdrawalDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<StoreWithdrawalView> {
    return this.withdrawals.pay(requestId, staff.id, body);
  }
}

function oneOf<T extends string>(
  name: string,
  value: string | undefined,
  allowed: readonly T[],
): { status?: T } {
  if (value === undefined || value === '') return {};
  if (!(allowed as readonly string[]).includes(value)) {
    throw new BadRequestException({
      code: 'INVALID_STATUS',
      message: `${name} must be one of ${allowed.join(', ')}`,
    });
  }
  return { status: value as T };
}

function uuid(name: string, value: string | undefined): { storeId?: string } {
  if (value === undefined || value === '') return {};
  if (!UUID.test(value)) {
    throw new BadRequestException({ code: 'INVALID_STORE_ID', message: `${name} must be a uuid` });
  }
  return { storeId: value };
}
