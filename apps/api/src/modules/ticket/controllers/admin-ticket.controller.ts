import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorType, type TicketStatus, type TicketType } from '@skydrop/db';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { TransitionTicketDto } from '../dto/ticket.dto';
import { TicketService, type TicketView } from '../services/ticket.service';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { AddTicketNoteDto } from '../dto/add-ticket-note.dto';

/**
 * R7 — the ops resolution panel's backend: one queue for auto-raised
 * scrap/damage claims and seller-raised parcel issues.
 */
@ApiTags('admin-tickets')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('tickets.view')
@Controller('admin/tickets')
export class AdminTicketController {
  constructor(private readonly tickets: TicketService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List/filter tickets by seller, status, type' })
  list(
    @Query('sellerId') sellerId?: string,
    @Query('status') status?: TicketStatus,
    @Query('ticketType') ticketType?: TicketType,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ items: readonly TicketView[]; total: number; page: number; pageSize: number }> {
    return this.tickets.listForAdmin({
      ...(sellerId === undefined ? {} : { sellerId }),
      ...(status === undefined ? {} : { status }),
      ...(ticketType === undefined ? {} : { ticketType }),
      ...(page === undefined ? {} : { page: Number(page) }),
      ...(pageSize === undefined ? {} : { pageSize: Number(pageSize) }),
    });
  }

  @Post(':ticketId/notes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Tell the seller what we found out, without moving the ticket',
  })
  addNote(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('ticketId', new ParseUUIDPipe({ version: '7' })) ticketId: string,
    @Body() body: AddTicketNoteDto,
  ): ReturnType<TicketService['addNote']> {
    return this.tickets.addNote(ticketId, body.note, {
      type: ActorType.STAFF,
      staffId: staff.id,
    });
  }

  @Get(':ticketId/events')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Append-only status history for a ticket' })
  events(@Param('ticketId') ticketId: string) {
    return this.tickets.listEvents(ticketId);
  }

  @Patch(':ticketId')
  @RequirePermissions('tickets.resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Move a ticket along its lifecycle. RESOLVED_REFUND credits the seller (SCRAP_REFUND wallet entry) in the same tx. Rejects INVALID_TICKET_TRANSITION / REFUND_AMOUNT_REQUIRED / REFUND_AMOUNT_NOT_APPLICABLE',
  })
  transition(
    @Param('ticketId') ticketId: string,
    @Body() body: TransitionTicketDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<TicketView> {
    return this.tickets.transition(ticketId, body, {
      type: ActorType.STAFF,
      staffId: staff.id,
    });
  }
}
