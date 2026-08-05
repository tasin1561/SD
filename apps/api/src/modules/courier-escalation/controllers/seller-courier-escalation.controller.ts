import {
  Body,
  Controller,
  Get,
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
import { PostReplyDto } from '../dto/courier-ops.dto';
import {
  CourierEscalationService,
  type EscalationView,
} from '../services/courier-escalation.service';

/**
 * The seller's side of the courier conversation.
 *
 * ── THIS IS THE PRODUCT PROMISE ──────────────────────────────────────
 * "Sellers report shipment problems in the Skydrop app and converse with
 * Delhivery support without a human relaying messages." Everything else
 * in this module is machinery for that sentence, and until this controller
 * existed the sentence was not true from the seller's side: they could
 * raise a ticket and never see a reply.
 *
 * ── OWNERSHIP IS CHECKED THROUGH THE TICKET ──────────────────────────
 * The service scopes every read by the authenticated seller, resolved
 * through `escalation.ticket.sellerId` rather than from anything the
 * caller sends. A miss and a not-yours both return the same generic 404:
 * whether another seller's escalation exists is not something to leak.
 *
 * ── READS ARE OPEN, REPLYING IS A WRITE ──────────────────────────────
 * `tickets.view` to read the thread — same as the ticket it hangs off, so
 * anyone who can see the problem can see the conversation about it.
 * Replying needs `tickets.create`: it puts words in front of the courier
 * under the company's name.
 */
@ApiTags('seller-courier-escalation')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('tickets.view')
@Controller('seller/courier-escalations')
export class SellerCourierEscalationController {
  constructor(private readonly escalations: CourierEscalationService) {}

  @Get('by-ticket/:ticketId')
  @ApiOperation({
    summary:
      'The courier conversation for one of your tickets, or null if none has been opened yet.',
  })
  byTicket(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('ticketId', new ParseUUIDPipe({ version: '7' })) ticketId: string,
  ): Promise<EscalationView | null> {
    return this.escalations.forTicket(ticketId, seller.id);
  }

  @Get(':escalationId')
  @ApiOperation({ summary: 'The full thread, oldest message first.' })
  thread(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('escalationId', new ParseUUIDPipe({ version: '7' })) escalationId: string,
  ): Promise<EscalationView> {
    return this.escalations.thread(escalationId, seller.id);
  }

  @Post(':escalationId/reply')
  @HttpCode(HttpStatus.CREATED)
  @RequireSellerPermissions('tickets.create')
  @ApiOperation({
    summary:
      'Send a message to the courier. Stored verbatim and queued for delivery — never rewritten or translated.',
  })
  reply(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('escalationId', new ParseUUIDPipe({ version: '7' })) escalationId: string,
    @Body() body: PostReplyDto,
  ): Promise<{ messageId: string; outboxItemId: string | null }> {
    return this.escalations.postReply({
      escalationId,
      body: body.body,
      sellerId: seller.id,
    });
  }
}
