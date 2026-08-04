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
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerAuthAllowSuspended } from '../../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import {
  WalletTopupService,
  type TopupPresignResult,
  type TopupRequestView,
} from '../services/wallet-topup.service';
import { ListTopupsQueryDto, PresignTopupProofDto, SubmitTopupDto } from '../dto/wallet-topup.dto';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';

/**
 * Putting money into your own wallet.
 *
 * Every route here is allowed while SUSPENDED, deliberately. A suspended
 * seller may well owe us money, and the point of suspension is to stop
 * them shipping — not to stop them paying.
 */
@ApiTags('seller-wallet-topup')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('wallet.view')
@Controller('seller/wallet/topups')
export class SellerTopupController {
  constructor(private readonly svc: WalletTopupService) {}

  @Get('bank-accounts')
  @SellerAuthAllowSuspended()
  @ApiOperation({ summary: 'The accounts you can send money to' })
  banks(): ReturnType<WalletTopupService['listBankAccounts']> {
    return this.svc.listBankAccounts();
  }

  @Post('proof-upload')
  @RequireSellerPermissions('wallet.topup')
  @HttpCode(HttpStatus.OK)
  @SellerAuthAllowSuspended()
  @ApiOperation({
    summary: 'A short-lived URL to PUT the transfer proof to, plus the key to submit with it',
  })
  presign(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: PresignTopupProofDto,
  ): Promise<TopupPresignResult> {
    return this.svc.presignProof(seller.id, body.mimeType);
  }

  @Post()
  @RequireSellerPermissions('wallet.topup')
  @HttpCode(HttpStatus.CREATED)
  @SellerAuthAllowSuspended()
  @ApiOperation({
    summary:
      'Declare a transfer you have made. Needs a transaction reference OR a proof upload. The wallet is credited only after we find it on our statement.',
  })
  submit(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: SubmitTopupDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<TopupRequestView> {
    return this.svc.submit(seller.id, seller.userId, body, ctx);
  }

  @Get()
  @SellerAuthAllowSuspended()
  @ApiOperation({ summary: 'Your top-up requests, newest first' })
  list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query() query: ListTopupsQueryDto,
  ): Promise<TopupRequestView[]> {
    return this.svc.listForSeller(seller.id, query.status);
  }

  @Get(':topupId/proof-url')
  @SellerAuthAllowSuspended()
  @ApiOperation({ summary: 'A short-lived link to your own uploaded proof' })
  async proof(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('topupId', new ParseUUIDPipe({ version: '7' })) topupId: string,
  ): Promise<{ url: string }> {
    // Scoped to this seller — the service filters on it, so one seller
    // cannot mint a read link for another's bank screenshot.
    return { url: await this.svc.proofUrl(topupId, seller.id) };
  }
}
