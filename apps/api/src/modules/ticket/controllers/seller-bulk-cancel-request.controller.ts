import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { BulkCancelRequestDto } from '../../../common/bulk/bulk-action.dto';
import { BulkRunnerService, type BulkResult } from '../../../common/bulk/bulk-runner.service';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { CANCEL_REQUEST_REASON } from '../../cancel-request/cancel-request.rules';
import { SellerIssueEscalationService } from '../../courier-escalation/services/seller-issue-escalation.service';
import { CancelRequestService, type CancelRequestResult } from '../services/cancel-request.service';

/** "Ticket TK-12 opened" / "Ticket TK-12 was already open". */
function noteFor(r: CancelRequestResult): string {
  return r.created
    ? `Ticket ${r.ticket.number} opened`
    : `Ticket ${r.ticket.number} was already open`;
}

/**
 * Bulk "request cancellation": `CancelRequestService.raise` per id — one
 * ticket per order, the existing open ticket returned (never a second),
 * the advisory lock and window rules all the single action's.
 */
@ApiTags('seller-tickets')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('orders.cancel')
@Controller('seller/bulk/orders')
export class SellerBulkCancelRequestController {
  constructor(
    private readonly cancelRequests: CancelRequestService,
    private readonly escalation: SellerIssueEscalationService,
    private readonly bulk: BulkRunnerService,
  ) {}

  @Post('cancel-request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Ask Skydrop to cancel up to 200 orders past the direct-cancel window — one ticket per order; an order with an open cancel ticket keeps it.',
  })
  raise(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: BulkCancelRequestDto,
  ): Promise<BulkResult> {
    return this.bulk.run(
      {
        actor: { type: 'SELLER', id: seller.userId },
        action: 'seller.cancel-request',
        idempotencyKey: body.idempotencyKey,
        ids: body.orderIds,
        params: { note: body.note ?? null },
      },
      async (orderId) => {
        const result = await this.cancelRequests.raise(
          { kind: 'SELLER', sellerId: seller.id, sellerUserId: seller.userId },
          orderId,
          body.note ?? null,
        );
        // Same post-commit courier conversation as the single action.
        if (result.created) {
          void this.escalation.escalate({
            ticketId: result.ticket.id,
            sellerId: seller.id,
            description: body.note
              ? `${CANCEL_REQUEST_REASON}\n\n${body.note}`
              : CANCEL_REQUEST_REASON,
          });
        }
        return noteFor(result);
      },
    );
  }
}
