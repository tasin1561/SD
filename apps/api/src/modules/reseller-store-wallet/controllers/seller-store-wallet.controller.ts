import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import {
  SellerStorePayoutDto,
  SellerStoreTopUpDto,
  SetStoreNegativeLimitDto,
  StoreWalletLedgerQueryDto,
} from '../dto/reseller-store-wallet.dto';
import {
  SellerManagedStoreWalletService,
  type SellerStoreMoveResult,
} from '../services/seller-managed-store-wallet.service';
import {
  StoreWalletService,
  type StoreNegativeLimit,
  type StoreWalletLedger,
  type StoreWalletSummary,
} from '../services/store-wallet.service';

/**
 * A seller's view of one of their reseller stores' wallets (RS-6), and the
 * three things they may do to it: top up a store they manage from their own
 * wallet, record paying it off-platform (decision 9), and set how far below
 * zero it may go (their risk; Skydrop caps it).
 *
 * Every handler needs `stores.wallet`, READS included — a store's money is
 * a separate business's, not everyone-at-the-seller's. Every query carries
 * the seller id from the TOKEN, so another seller's store is a 404.
 */
@ApiTags('seller-reseller-store-wallet')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('stores.wallet')
@Controller('seller/reseller-stores/:storeId/wallet')
export class SellerStoreWalletController {
  constructor(
    private readonly wallet: StoreWalletService,
    private readonly moves: SellerManagedStoreWalletService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'The store’s balance, negative limit and what is pending' })
  summary(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
  ): Promise<StoreWalletSummary> {
    return this.wallet.summary({ storeId, sellerId: seller.id });
  }

  @Get('entries')
  @ApiOperation({ summary: 'Every movement of the store’s wallet, newest first' })
  entries(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Query() q: StoreWalletLedgerQueryDto,
  ): Promise<StoreWalletLedger> {
    return this.wallet.ledger(
      { storeId, sellerId: seller.id },
      { ...(q.before === undefined ? {} : { before: q.before }), limit: q.limit ?? 50 },
    );
  }

  @Post('top-up')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move money from your wallet into a store you manage' })
  topUp(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Body() body: SellerStoreTopUpDto,
  ): Promise<SellerStoreMoveResult> {
    return this.moves.topUp(seller.id, storeId, body, { sellerUserId: seller.userId });
  }

  @Post('payouts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record paying a store you manage, off-platform (HIGH audit)' })
  recordPayout(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Body() body: SellerStorePayoutDto,
  ): Promise<SellerStoreMoveResult> {
    return this.moves.recordPayout(seller.id, storeId, body, { sellerUserId: seller.userId });
  }

  @Patch('negative-limit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'How far below zero the store may go (capped by Skydrop)' })
  setNegativeLimit(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Body() body: SetStoreNegativeLimitDto,
  ): Promise<StoreNegativeLimit> {
    return this.wallet.setNegativeLimit(seller.id, storeId, body.negativeLimitInr, {
      sellerUserId: seller.userId,
    });
  }
}
