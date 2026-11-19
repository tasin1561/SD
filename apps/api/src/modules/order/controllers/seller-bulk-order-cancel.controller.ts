import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorType } from '@skydrop/db';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { BulkCancelDto } from '../../../common/bulk/bulk-action.dto';
import { BulkRunnerService, type BulkResult } from '../../../common/bulk/bulk-runner.service';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { OrderWriteService } from '../services/order-write.service';

/**
 * Bulk cancel — the SAME write the single-order cancel makes, once per
 * id, one at a time (see BulkRunnerService). Route prefix `.../bulk/orders`
 * rather than `.../orders/bulk` so it can never be read as `:id = "bulk"`.
 */
@ApiTags('seller-orders')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('orders.cancel')
@Controller('seller/bulk/orders')
export class SellerBulkOrderCancelController {
  constructor(
    private readonly orderWrite: OrderWriteService,
    private readonly bulk: BulkRunnerService,
  ) {}

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cancel up to 200 orders — each exactly as its own Cancel button would (until packed; a delivery fee already taken is refunded). One result per order.',
  })
  cancel(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: BulkCancelDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<BulkResult> {
    const actor = { type: ActorType.SELLER, id: seller.id };
    return this.bulk.run(
      {
        actor: { type: 'SELLER', id: seller.userId },
        action: 'seller.cancel',
        idempotencyKey: body.idempotencyKey,
        ids: body.orderIds,
        params: { reason: body.reason ?? null, note: body.note ?? null },
      },
      async (orderId) => {
        await this.orderWrite.cancelBySeller({
          sellerId: seller.id,
          orderId,
          actor,
          ...(body.reason !== undefined ? { cancellationReason: body.reason } : {}),
          ...(body.note !== undefined ? { note: body.note } : {}),
          ctx,
        });
      },
    );
  }
}
