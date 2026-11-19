import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { BulkCancelRequestDto } from '../../../common/bulk/bulk-action.dto';
import { BulkRunnerService, type BulkResult } from '../../../common/bulk/bulk-runner.service';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { CancelRequestService, type CancelRequestResult } from '../services/cancel-request.service';

/** "Ticket TK-12 opened" / "Ticket TK-12 was already open". */
function noteFor(r: CancelRequestResult): string {
  return r.created
    ? `Ticket ${r.ticket.number} opened`
    : `Ticket ${r.ticket.number} was already open`;
}

@ApiTags('store-orders')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('orders.cancel')
@Controller('store/bulk/orders')
export class StoreBulkCancelRequestController {
  constructor(
    private readonly cancelRequests: CancelRequestService,
    private readonly bulk: BulkRunnerService,
  ) {}

  @Post('cancel-request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Ask Skydrop to cancel up to 200 of this store’s orders past the direct-cancel window — refused per order when the seller turned cancelling off.',
  })
  raise(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: BulkCancelRequestDto,
  ): Promise<BulkResult> {
    return this.bulk.run(
      {
        actor: { type: 'STORE_USER', id: user.id },
        action: 'store.cancel-request',
        idempotencyKey: body.idempotencyKey,
        ids: body.orderIds,
        params: { note: body.note ?? null },
      },
      async (orderId) =>
        noteFor(
          await this.cancelRequests.raise(
            {
              kind: 'STORE',
              storeId: user.storeId,
              storeUserId: user.id,
              orderScope: user.orderScope,
            },
            orderId,
            body.note ?? null,
          ),
        ),
    );
  }
}
