import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerAuthAllowSuspended } from '../../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { CreateWithdrawalRequestDto } from '../dto/withdrawal-request.dto';
import {
  WithdrawalRequestService,
  type WithdrawalRequestView,
} from '../services/withdrawal-request.service';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';

/**
 * Seller-facing withdrawal-request endpoints (R2). Creating a request
 * is a new-business-action — NOT allowed while suspended (no
 * `@SellerAuthAllowSuspended` on `create`). Listing one's own past
 * requests is read-only and IS allowed while suspended, matching
 * `SellerWalletController`'s balance/entries endpoints.
 */
@ApiTags('seller-wallet-withdrawal')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('wallet.view')
@Controller('seller/wallet/withdrawal-requests')
export class SellerWithdrawalRequestController {
  constructor(private readonly svc: WithdrawalRequestService) {}

  @Post()
  @RequireSellerPermissions('wallet.withdraw')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Request a withdrawal (rejects BELOW_MIN_THRESHOLD / WITHDRAWAL_DAILY_LIMIT_REACHED / INSUFFICIENT_WALLET_BALANCE)',
  })
  create(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: CreateWithdrawalRequestDto,
  ): Promise<WithdrawalRequestView> {
    return this.svc.create(seller.id, seller.userId, body);
  }

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "List this seller's own withdrawal requests" })
  list(@CurrentSeller() seller: AuthenticatedSeller): Promise<readonly WithdrawalRequestView[]> {
    return this.svc.listForSeller(seller.id);
  }
}
