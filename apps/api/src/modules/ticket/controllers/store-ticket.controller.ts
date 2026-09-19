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
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { AddTicketNoteDto } from '../dto/add-ticket-note.dto';
import { CreateStoreDisputeDto, StoreTicketListQueryDto } from '../dto/store-ticket.dto';
import { TicketService, type StoreTicketView } from '../services/ticket.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * RS-7 — a reseller store's disputes with its seller, refereed by Skydrop.
 *
 * The store is the caller's TOKEN's, never a parameter: every read and
 * write is scoped by it in the WHERE clause, so another store's dispute —
 * or any of the seller's own tickets — is the same 404 as one that does
 * not exist.
 */
@ApiTags('store-tickets')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('tickets.view')
@Controller('store/tickets')
export class StoreTicketController {
  constructor(private readonly tickets: TicketService) {}

  @Get()
  @ApiOperation({ summary: 'This store’s disputes, newest first' })
  list(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Query() query: StoreTicketListQueryDto,
  ): Promise<{ items: StoreTicketView[]; total: number; page: number; pageSize: number }> {
    return this.tickets.listForStore(user.storeId, {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.stage === undefined ? {} : { stage: query.stage }),
      ...(query.page === undefined ? {} : { page: query.page }),
      ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
    });
  }

  @Post()
  @RequireStorePermissions('tickets.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Raise a dispute with the seller about one of this store’s orders. Skydrop referees; a settlement moves money between the store and the seller.',
  })
  create(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: CreateStoreDisputeDto,
  ): Promise<StoreTicketView> {
    return this.tickets.openForStore({
      storeId: user.storeId,
      storeUserId: user.id,
      orderId: body.orderId,
      subject: body.subject,
      description: body.description ?? null,
      // RS-7 (2026-09-19) — a "correct the figures" dispute carries what
      // is being corrected. Absent, this is the ordinary GENERAL dispute.
      ...(body.disputeKind === undefined ? {} : { disputeKind: body.disputeKind }),
      ...(body.claimAmountInr === undefined ? {} : { claimAmountInr: body.claimAmountInr }),
      ...(body.claimPayer === undefined ? {} : { claimPayer: body.claimPayer }),
    });
  }

  @Get(':ticketId')
  @ApiOperation({ summary: 'One of this store’s disputes (404 for anything else)' })
  get(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('ticketId', uuid()) ticketId: string,
  ): Promise<StoreTicketView> {
    return this.tickets.getForStore(user.storeId, ticketId);
  }

  @Get(':ticketId/events')
  @ApiOperation({ summary: 'The dispute’s conversation and history, oldest first' })
  events(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('ticketId', uuid()) ticketId: string,
  ): ReturnType<TicketService['eventsForStore']> {
    return this.tickets.eventsForStore(user.storeId, ticketId);
  }

  @Post(':ticketId/notes')
  @RequireStorePermissions('tickets.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Reply on one of this store’s disputes while it is still open. Refused once it is closed — a reply there reaches nobody.',
  })
  reply(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('ticketId', uuid()) ticketId: string,
    @Body() body: AddTicketNoteDto,
  ): Promise<{ ticketId: string; at: Date }> {
    return this.tickets.addNoteForStore(user.storeId, user.id, ticketId, body.note);
  }
}
