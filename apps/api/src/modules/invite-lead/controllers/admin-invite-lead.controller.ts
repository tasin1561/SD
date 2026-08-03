import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ParseUUIDPipe } from '@nestjs/common';
import { StaffRole } from '@skydrop/db';
import { requireStaffRoles } from '../../../common/auth/require-staff-roles';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { ListInviteLeadsQueryDto, UpdateInviteLeadDto } from '../dto/invite-lead.dto';
import { InviteLeadService, type LeadView } from '../services/invite-lead.service';

/**
 * The leads queue.
 *
 * Open to SUPER_ADMIN and SELLER_APPROVAL_ADMIN — the same people who
 * decide who gets invited, since that is the next step for anything in
 * here.
 */
@ApiTags('admin-marketing')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/invite-leads')
export class AdminInviteLeadController {
  constructor(private readonly leads: InviteLeadService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List invite requests, newest first' })
  list(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Query() query: ListInviteLeadsQueryDto,
  ): ReturnType<InviteLeadService['list']> {
    requireStaffRoles(staff, [StaffRole.SUPER_ADMIN, StaffRole.SELLER_APPROVAL_ADMIN]);
    return this.leads.list(query);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move a lead along, and record what was said' })
  update(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: UpdateInviteLeadDto,
  ): Promise<LeadView> {
    requireStaffRoles(staff, [StaffRole.SUPER_ADMIN, StaffRole.SELLER_APPROVAL_ADMIN]);
    return this.leads.update(id, body, staff.id);
  }
}
