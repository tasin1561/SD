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
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import {
  RequestStoreWithdrawalDto,
  StoreTopupProofPresignDto,
  StoreWalletLedgerQueryDto,
  SubmitStoreTopupDto,
} from '../dto/reseller-store-wallet.dto';
import {
  StoreTopupService,
  type StoreBankAccountView,
  type StoreTopupPresign,
  type StoreTopupView,
} from '../services/store-topup.service';
import {
  StoreWalletService,
  type StoreWalletLedger,
  type StoreWalletSummary,
} from '../services/store-wallet.service';
import {
  StoreWithdrawalService,
  type StoreWithdrawalView,
} from '../services/store-withdrawal.service';

/**
 * A reseller store's OWN wallet (RS-6). Always the caller's store: the id
 * comes from the token, never the request, so there is no store id in any
 * path here by construction. A SELLER-managed wallet reads here and moves
 * only by the seller; a SKYDROP-managed one tops up to our bank and
 * withdraws through us.
 */
@ApiTags('store-wallet')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('wallet.view')
@Controller('store/wallet')
export class StoreWalletController {
  constructor(
    private readonly wallet: StoreWalletService,
    private readonly topups: StoreTopupService,
    private readonly withdrawals: StoreWithdrawalService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'The balance, what may be withdrawn, and what is pending' })
  summary(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<StoreWalletSummary> {
    return this.wallet.summary({ storeId: user.storeId });
  }

  @Get('entries')
  @ApiOperation({ summary: 'Every movement of the wallet, newest first' })
  entries(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Query() q: StoreWalletLedgerQueryDto,
  ): Promise<StoreWalletLedger> {
    return this.wallet.ledger(
      { storeId: user.storeId },
      { ...(q.before === undefined ? {} : { before: q.before }), limit: q.limit ?? 50 },
    );
  }

  @Get('bank-accounts')
  @ApiOperation({ summary: 'Our rupee accounts a top-up may be sent to' })
  bankAccounts(): Promise<readonly StoreBankAccountView[]> {
    return this.topups.bankAccounts();
  }

  @Get('topups')
  @ApiOperation({ summary: 'This store’s top-up claims' })
  listTopups(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<readonly StoreTopupView[]> {
    return this.topups.listForStore(user.storeId);
  }

  @Get('topups/:topupId/proof')
  @ApiOperation({ summary: 'A short-lived link to a claim’s proof' })
  proof(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('topupId', new ParseUUIDPipe()) topupId: string,
  ): Promise<{ url: string }> {
    return this.topups.proofUrl(topupId, user.storeId);
  }

  @Post('topups/proof-upload')
  @RequireStorePermissions('wallet.topups.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'A presigned PUT for the transfer proof, and the key to submit' })
  presignProof(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: StoreTopupProofPresignDto,
  ): Promise<StoreTopupPresign> {
    return this.topups.presignProof(user.storeId, body.mimeType);
  }

  @Post('topups')
  @RequireStorePermissions('wallet.topups.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Tell us about money sent — credited once we see it arrive' })
  submitTopup(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: SubmitStoreTopupDto,
  ): Promise<StoreTopupView> {
    return this.topups.submit(user, body);
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'This store’s withdrawal requests' })
  listWithdrawals(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
  ): Promise<readonly StoreWithdrawalView[]> {
    return this.withdrawals.listForStore(user.storeId);
  }

  @Post('withdrawals')
  @RequireStorePermissions('wallet.withdrawals.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Ask to be paid — nothing moves until Skydrop pays it' })
  requestWithdrawal(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: RequestStoreWithdrawalDto,
  ): Promise<StoreWithdrawalView> {
    return this.withdrawals.request(user, body);
  }
}
