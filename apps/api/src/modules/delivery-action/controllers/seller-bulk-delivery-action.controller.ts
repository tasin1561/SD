import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { BulkDeliveryActionDto } from '../../../common/bulk/bulk-action.dto';
import { BulkRunnerService, type BulkResult } from '../../../common/bulk/bulk-runner.service';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { DeliveryActionService } from '../services/delivery-action.service';

/**
 * Bulk delivery actions on failed parcels. The client ASKS
 * (`DeliveryActionService.request` per order — a return goes to the
 * courier at once, a re-attempt / recall waits for an operator, exactly as
 * the single action); staff DECIDE those asks in bulk
 * (`DeliveryActionDecisionService.approve` / `reject` per request).
 */
@ApiTags('seller-delivery-actions')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
// Same permission as the single request (see SellerDeliveryActionController).
@RequireSellerPermissions('orders.create')
@Controller('seller/bulk/orders')
export class SellerBulkDeliveryActionController {
  constructor(
    private readonly svc: DeliveryActionService,
    private readonly bulk: BulkRunnerService,
  ) {}

  @Post('delivery-actions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Re-attempt / recall / return up to 200 failed parcels with one shared reason — each as its own request would. One result per order.',
  })
  request(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: BulkDeliveryActionDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<BulkResult> {
    return this.bulk.run(
      {
        actor: { type: 'SELLER', id: seller.userId },
        action: 'seller.delivery-action',
        idempotencyKey: body.idempotencyKey,
        ids: body.orderIds,
        params: { action: body.action, reason: body.reason },
      },
      async (orderId) => {
        await this.svc.request({
          sellerId: seller.id,
          sellerUserId: seller.userId,
          orderId,
          action: body.action,
          reason: body.reason,
          ctx,
        });
      },
    );
  }
}
