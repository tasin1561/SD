import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorType, type TicketStatus, TicketType } from '@skydrop/db';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerAuthAllowSuspended } from '../../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { CreateSellerTicketDto } from '../dto/ticket.dto';
import { CreateSellerStoreDisputeDto } from '../dto/store-ticket.dto';
import { type TicketStage, TicketService, type TicketView } from '../services/ticket.service';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { AddTicketNoteDto } from '../dto/add-ticket-note.dto';
import { SellerIssueEscalationService } from '../../courier-escalation/services/seller-issue-escalation.service';

/**
 * R7 — seller-facing parcel-issue tickets. Raising one is an OPS-domain
 * action (class-level @SellerRoles = the WRITE allow-list); reads stay
 * open to every company role including VIEWER, per the R0 RBAC policy.
 */
@ApiTags('seller-tickets')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('tickets.view')
@Controller('seller/tickets')
export class SellerTicketController {
  constructor(
    private readonly tickets: TicketService,
    private readonly escalation: SellerIssueEscalationService,
  ) {}

  @Post()
  @RequireSellerPermissions('tickets.create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Raise a parcel/order issue ticket' })
  async create(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: CreateSellerTicketDto,
  ): Promise<TicketView> {
    const ticket = await this.tickets.open(
      {
        ticketType: TicketType.SELLER_RAISED_ISSUE,
        sellerId: seller.id,
        subject: body.subject,
        description: body.description ?? null,
        orderId: body.orderId ?? null,
        shipmentId: body.shipmentId ?? null,
        issueCategoryExternalId: body.issueCategoryExternalId ?? null,
        issueSubcategoryExternalId: body.issueSubcategoryExternalId ?? null,
      },
      { type: ActorType.SELLER, sellerUserId: seller.userId },
    );

    /*
      POST-COMMIT, fire-and-forget: the ticket is the durable fact and
      it has already saved. A courier conversation that cannot be opened
      must never fail the seller's report — they would be told it did
      not go through while we are holding it — so the escalation runs
      after, swallows its own failures, and puts them on the board.

      Not awaited, because the seller is waiting on this response and
      the portal is a browser session on the other side of an
      internet: making them watch it would trade their whole page load
      against a step that has its own retry.
    */
    void this.escalation.escalate({
      ticketId: ticket.id,
      sellerId: seller.id,
      description: body.description ?? null,
    });

    return ticket;
  }

  /**
   * RS-7 (2026-09-19) — raise a dispute with one of YOUR OWN reseller
   * stores, about one of that store's orders.
   *
   * A separate handler rather than a flag on `create`: a
   * SELLER_RAISED_ISSUE is a conversation with SKYDROP about a parcel,
   * and a STORE_DISPUTE is a conversation with a STORE that Skydrop
   * referees and may settle between the two wallets. Mixing them would
   * put the courier-escalation side-effect on a dispute that has no
   * courier in it. A fixed segment, so it cannot collide with
   * `:ticketId/notes`.
   */
  @Post('store-disputes')
  @RequireSellerPermissions('tickets.create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Raise a dispute with one of your reseller stores about one of its orders. Skydrop referees; a settlement moves money between your wallet and the store’s. Use FIGURE_CORRECTION when the money worked out on the order is wrong.',
  })
  createStoreDispute(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: CreateSellerStoreDisputeDto,
  ): Promise<TicketView> {
    return this.tickets.openForSellerAgainstStore({
      sellerId: seller.id,
      sellerUserId: seller.userId,
      orderId: body.orderId,
      subject: body.subject,
      description: body.description ?? null,
      ...(body.disputeKind === undefined ? {} : { disputeKind: body.disputeKind }),
      ...(body.claimAmountInr === undefined ? {} : { claimAmountInr: body.claimAmountInr }),
      ...(body.claimPayer === undefined ? {} : { claimPayer: body.claimPayer }),
    });
  }

  @Post(':ticketId/notes')
  @RequireSellerPermissions('tickets.create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Reply on your own ticket while it is still open. Refused once it is closed — a reply there reaches nobody.',
  })
  reply(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('ticketId', new ParseUUIDPipe({ version: '7' })) ticketId: string,
    @Body() body: AddTicketNoteDto,
  ): ReturnType<TicketService['addNote']> {
    return this.tickets.addNote(
      ticketId,
      body.note,
      { type: ActorType.SELLER, sellerUserId: seller.userId },
      // Scoped AND open-only: another company's ticket is a 404, and a
      // closed one is refused rather than silently accepted.
      { sellerId: seller.id, openOnly: true },
    );
  }

  @Get('issue-categories')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "The courier's own issue categories, as a two-level tree. A category with no subcategories goes straight to the description — that is how the courier's own form behaves.",
  })
  issueCategories(): ReturnType<TicketService['issueTaxonomy']> {
    return this.tickets.issueTaxonomy();
  }

  @Get(':ticketId/events')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'What has happened on this ticket — including what we found out for you',
  })
  events(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('ticketId', new ParseUUIDPipe({ version: '7' })) ticketId: string,
  ): ReturnType<TicketService['events']> {
    // Scoped to the seller inside the service, so another company's
    // ticket is indistinguishable from one that does not exist.
    return this.tickets.events(ticketId, seller.id);
  }

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "List this seller's tickets (scrap + self-raised). Filter by orderId to show what has been raised on one parcel — an order may carry several.",
  })
  list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query('status') status?: TicketStatus,
    @Query('orderId') orderId?: string,
    // Open / Reviewing / Closed — the three the screens speak in.
    // `status` still works for anything wanting one exact outcome.
    @Query('stage') stage?: TicketStage,
    /** Ticket number, subject, order number, parcel number or waybill. */
    @Query('search') search?: string,
  ): Promise<readonly TicketView[]> {
    return this.tickets.listForSeller(seller.id, status, orderId, stage, search);
  }

  @Get(':ticketId')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Ticket detail (404 for another seller's ticket)" })
  detail(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('ticketId') ticketId: string,
  ): Promise<TicketView> {
    return this.tickets.getForSeller(seller.id, ticketId);
  }
}
