import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
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

  // A seller USED to be able to POST a reply straight to the courier.
  //
  // Withdrawn 2026-09-05, MANUAL PATH FIRST. We are the operational
  // backbone: the reason a seller in Dhaka needs no Indian operation is
  // precisely that they never deal with Delhivery themselves. They tell
  // us on the ticket, and we carry it — by hand for now.
  //
  // AUTOMATION IS THE PLAN, and it does not need this route back. A
  // relay that forwards a seller's ticket reply to the courier runs on
  // OUR side and calls `CourierEscalationService.postReply` directly —
  // which still takes `sellerId`, so a message sent on a seller's
  // behalf is still attributed to them rather than to whoever happened
  // to be on shift. What is gone is a SELLER-AUTHENTICATED write, not
  // the capability.
  //
  // Removed rather than hidden in the UI, because FE-2 makes the server
  // the boundary and the screen cosmetic: a route left standing would
  // still accept the call from anything holding a seller token, which
  // is the class of hole that rule exists to close. Staff keep their
  // own relay (`AdminCourierEscalationController.reply`), and
  // `DeliveryActionService` already posts through the same service.
}
