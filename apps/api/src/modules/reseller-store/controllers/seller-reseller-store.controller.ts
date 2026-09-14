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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorType } from '@skydrop/db';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import {
  ApproveResellerStoreDto,
  CreateResellerStoreDto,
  InviteStoreUserDto,
  OptionalReasonDto,
  ResellerStoreReasonDto,
  SetWalletManagerDto,
} from '../dto/reseller-store.dto';
import {
  ResellerStoreService,
  type ResellerStoreDetail,
  type ResellerStoreView,
} from '../services/reseller-store.service';
import { StoreTeamService, type StoreInvitationView } from '../services/store-team.service';

/**
 * A seller's reseller stores (RS-1) — create, approve or reject one we
 * opened for them, pause, resume, close, choose who manages its wallet,
 * and see and invite its team.
 *
 * Every handler needs `stores.manage`, READS included: a store's team and
 * history belong to a separate business, not to everyone at the seller.
 * Deliberately NOT viewer-readable (RBAC-1's allow-list) for the same
 * reason. Every query carries the seller id from the TOKEN.
 */
@ApiTags('seller-reseller-stores')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('stores.manage')
@Controller('seller/reseller-stores')
export class SellerResellerStoreController {
  constructor(
    private readonly stores: ResellerStoreService,
    private readonly team: StoreTeamService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Every reseller store this seller has, newest first' })
  list(@CurrentSeller() seller: AuthenticatedSeller): Promise<readonly ResellerStoreView[]> {
    return this.stores.listForSeller(seller.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Open a reseller store — ACTIVE at once, optionally inviting its first user',
  })
  create(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: CreateResellerStoreDto,
  ): Promise<ResellerStoreDetail> {
    return this.stores.create(seller.id, body, this.actor(seller));
  }

  @Get(':storeId')
  @ApiOperation({ summary: 'One reseller store, its history and its team' })
  detail(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
  ): Promise<ResellerStoreDetail> {
    return this.stores.detail(storeId, seller.id);
  }

  @Post(':storeId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a store Skydrop opened for you (HIGH audit)' })
  approve(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Body() body: ApproveResellerStoreDto,
  ): Promise<ResellerStoreDetail> {
    return this.stores.approve(seller.id, storeId, this.actor(seller), body.invite);
  }

  @Post(':storeId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a store Skydrop opened for you — final (HIGH audit)' })
  reject(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Body() body: ResellerStoreReasonDto,
  ): Promise<ResellerStoreDetail> {
    return this.stores.reject(seller.id, storeId, this.actor(seller), body.reason);
  }

  @Post(':storeId/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop NEW orders; orders already placed carry on' })
  pause(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Body() body: OptionalReasonDto,
  ): Promise<ResellerStoreDetail> {
    return this.stores.pause(seller.id, storeId, this.actor(seller), body.reason);
  }

  @Post(':storeId/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take new orders again' })
  resume(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
  ): Promise<ResellerStoreDetail> {
    return this.stores.resume(seller.id, storeId, this.actor(seller));
  }

  @Post(':storeId/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close for good — refused while any order is in flight (HIGH audit)' })
  close(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Body() body: ResellerStoreReasonDto,
  ): Promise<ResellerStoreDetail> {
    return this.stores.close(seller.id, storeId, this.actor(seller), body.reason);
  }

  @Patch(':storeId/wallet-manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Who manages the store’s wallet — you, or Skydrop' })
  setWalletManager(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Body() body: SetWalletManagerDto,
  ): Promise<ResellerStoreDetail> {
    return this.stores.setWalletManager(
      seller.id,
      storeId,
      body.walletManagedBy,
      this.actor(seller),
    );
  }

  @Post(':storeId/invitations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Invite somebody into the store’s team (email only — a credential message)',
  })
  invite(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Body() body: InviteStoreUserDto,
  ): Promise<StoreInvitationView> {
    return this.team.inviteAsSeller(seller.id, storeId, body, {
      sellerUserId: seller.userId,
      name: seller.fullName,
    });
  }

  @Post(':storeId/invitations/:invitationId/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Withdraw a pending invitation' })
  async revokeInvitation(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Param('invitationId', new ParseUUIDPipe({ version: '7' })) invitationId: string,
  ): Promise<void> {
    // Proves the store is THIS seller's before touching its rows.
    await this.team.sellerStore(seller.id, storeId);
    await this.team.revokeInvitation(storeId, invitationId, {
      type: ActorType.SELLER,
      id: seller.userId,
      sellerId: seller.id,
    });
  }

  private actor(seller: AuthenticatedSeller): {
    kind: 'SELLER';
    sellerUserId: string;
    name: string;
  } {
    return { kind: 'SELLER', sellerUserId: seller.userId, name: seller.fullName };
  }
}
