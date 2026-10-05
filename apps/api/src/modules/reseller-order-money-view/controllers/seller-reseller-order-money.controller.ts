import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import {
  ResellerOrderMoneyReadService,
  type ResellerOrderMoneyView,
} from '../services/reseller-order-money-read.service';

/**
 * The seller's view of one of their reseller stores' orders: the transfer
 * price they earn, their fee shares, and when.
 *
 * ── WHAT THIS DOCBLOCK USED TO CLAIM ────────────────────────────────
 * "Its own controller (not the order controller, which a VIEWER may
 * read — RBAC-1), so money is closed to that role by default." It was
 * declared `orders.view` — the ONE key `viewer` holds — so the comment
 * described a protection that did not exist, and the separate
 * controller bought nothing. The only thing keeping a Viewer out was a
 * client-side `identity.role !== 'VIEWER'` check in the seller app,
 * which had ALREADY stopped working for anybody on a custom role (the
 * legacy enum is null for them) and which FE-2 forbids being the only
 * check in any case.
 *
 * It is `stores.order_money.view` now — Admin and Finance by default,
 * an Owner implicitly, nobody else. Worth remembering as a shape: a
 * comment asserting a guarantee is not a guarantee, and this one
 * outlived the thing it described exactly as `@SellerRoles` did
 * (RBAC-1).
 */
@ApiTags('seller-orders')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('stores.order_money.view')
@Controller('seller/orders')
export class SellerResellerOrderMoneyController {
  constructor(private readonly read: ResellerOrderMoneyReadService) {}

  @Get(':id/reseller-money')
  @ApiOperation({ summary: 'A reseller store order: your transfer price, fee shares and when' })
  money(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<ResellerOrderMoneyView> {
    return this.read.forOrder(id, { audience: 'SELLER', sellerId: seller.id });
  }
}
