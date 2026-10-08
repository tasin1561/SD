import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { StoreOrderScope } from '@skydrop/db';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import {
  ResellerOrderMoneyReadService,
  type ResellerOrderMoneyView,
} from '../services/reseller-order-money-read.service';

/**
 * The store's own order: what it pays and earns on it, and when.
 *
 * ── NOT REACHABLE BY AN ASSOCIATE AT ALL (ASSOC-1) ───────────────────
 * This is the order's whole money plan — the transfer price, what each
 * party nets, and which Skydrop fee each side bears. It is the single
 * most direct answer to the owner's *"how much the reseller is getting
 * paid"*, and an associate holds `orders.view` so they can follow their
 * own parcels.
 *
 * It is REFUSED for an OWN-scope caller rather than narrowed to their
 * own orders, and that distinction is the whole point: narrowing it
 * would still hand them the store's margin on every sale THEY made,
 * which is exactly the figure withheld from them everywhere else. There
 * is no useful subset to show either — strip the store's side and what
 * is left is a screen of blanks.
 */
@ApiTags('store-orders')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('orders.view')
@Controller('store/orders')
export class StoreOrderMoneyController {
  constructor(private readonly read: ResellerOrderMoneyReadService) {}

  @Get(':id/money')
  @ApiOperation({ summary: 'What this order pays the store and the seller, and when' })
  money(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<ResellerOrderMoneyView> {
    if (user.orderScope === StoreOrderScope.OWN) {
      // 403 and not a 404: the order DOES exist and is theirs to follow,
      // so pretending otherwise would send them looking for a parcel
      // they can see on the next screen. What is refused is the figure.
      throw new ForbiddenException({
        code: 'STORE_MONEY_NOT_FOR_ASSOCIATE',
        message:
          'What this order pays the store and the seller is not shown to an associate. ' +
          'You can see the order, what the customer pays and where the parcel is.',
      });
    }
    return this.read.forOrder(id, { audience: 'STORE', storeId: user.storeId });
  }
}
