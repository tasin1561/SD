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
import { TicketService, type TicketView } from '../services/ticket.service';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';

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
  constructor(private readonly tickets: TicketService) {}

  @Post()
  @RequireSellerPermissions('tickets.create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Raise a parcel/order issue ticket' })
  create(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: CreateSellerTicketDto,
  ): Promise<TicketView> {
    return this.tickets.open(
      {
        ticketType: TicketType.SELLER_RAISED_ISSUE,
        sellerId: seller.id,
        subject: body.subject,
        description: body.description ?? null,
        orderId: body.orderId ?? null,
        shipmentId: body.shipmentId ?? null,
      },
      { type: ActorType.SELLER, sellerUserId: seller.userId },
    );
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
  @ApiOperation({ summary: "List this seller's tickets (scrap + self-raised)" })
  list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query('status') status?: TicketStatus,
  ): Promise<readonly TicketView[]> {
    return this.tickets.listForSeller(seller.id, status);
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
