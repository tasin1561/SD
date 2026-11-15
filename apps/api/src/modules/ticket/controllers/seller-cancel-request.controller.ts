import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { SellerIssueEscalationService } from '../../courier-escalation/services/seller-issue-escalation.service';
import { CancelRequestDto } from '../dto/cancel-request.dto';
import { CancelRequestService, type CancelRequestResult } from '../services/cancel-request.service';
import { CANCEL_REQUEST_REASON } from '../../cancel-request/cancel-request.rules';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/** 2026-11-15 — the client's "Cancel order" past the direct-cancel window: a ticket to Skydrop. */
@ApiTags('seller-tickets')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('orders.cancel')
@Controller('seller/orders')
export class SellerCancelRequestController {
  constructor(
    private readonly cancelRequests: CancelRequestService,
    private readonly escalation: SellerIssueEscalationService,
  ) {}

  @Post(':id/cancel-request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Ask Skydrop to cancel an order that is past the direct-cancel window. Opens one ticket; a second request while it is open returns the same ticket.',
  })
  async raise(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
    @Body() body: CancelRequestDto,
  ): Promise<CancelRequestResult> {
    const result = await this.cancelRequests.raise(
      { kind: 'SELLER', sellerId: seller.id, sellerUserId: seller.userId },
      id,
      body.note ?? null,
    );
    // Same post-commit courier conversation as any seller-raised issue; never
    // fails the request, and only when this call opened the ticket.
    if (result.created) {
      void this.escalation.escalate({
        ticketId: result.ticket.id,
        sellerId: seller.id,
        description: body.note ? `${CANCEL_REQUEST_REASON}\n\n${body.note}` : CANCEL_REQUEST_REASON,
      });
    }
    return result;
  }
}
