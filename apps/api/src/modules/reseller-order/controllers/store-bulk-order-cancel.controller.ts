import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { BulkCancelDto } from '../../../common/bulk/bulk-action.dto';
import { BulkRunnerService, type BulkResult } from '../../../common/bulk/bulk-runner.service';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { StoreOrdersService } from '../services/store-orders.service';

/**
 * Member store / associate bulk cancel: `StoreOrdersService.cancel` per id
 * — the store's cancel POLICY (OFF / DIRECT / ASK_SELLER) and the caller's
 * own order scope (an associate reaches only their own orders) are the
 * single action's, untouched.
 */
@ApiTags('store-orders')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('orders.cancel')
@Controller('store/bulk/orders')
export class StoreBulkOrderCancelController {
  constructor(
    private readonly orders: StoreOrdersService,
    private readonly bulk: BulkRunnerService,
  ) {}

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cancel up to 200 of this store’s orders — each as its own Cancel would: now, or sent to the seller for approval, per the policy. One result per order.',
  })
  cancel(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: BulkCancelDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<BulkResult> {
    return this.bulk.run(
      {
        actor: { type: 'STORE_USER', id: user.id },
        action: 'store.cancel',
        idempotencyKey: body.idempotencyKey,
        ids: body.orderIds,
        params: { reason: body.reason ?? null, note: body.note ?? null },
      },
      async (orderId) => {
        const out = await this.orders.cancel(
          user,
          orderId,
          {
            ...(body.reason !== undefined ? { reason: body.reason } : {}),
            ...(body.note !== undefined ? { note: body.note } : {}),
          },
          ctx,
        );
        return out.applied ? undefined : 'Sent to the seller for approval';
      },
    );
  }
}
