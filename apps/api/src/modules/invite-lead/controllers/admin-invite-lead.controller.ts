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

import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { ListInviteLeadsQueryDto, UpdateInviteLeadDto } from '../dto/invite-lead.dto';
import { InviteLeadService, type LeadView } from '../services/invite-lead.service';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

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
@RequirePermissions('leads.view')
@Controller('admin/invite-leads')
export class AdminInviteLeadController {
  constructor(private readonly leads: InviteLeadService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List invite requests, newest first' })
  list(@Query() query: ListInviteLeadsQueryDto): ReturnType<InviteLeadService['list']> {
    return this.leads.list(query);
  }

  @Patch(':id')
  @RequirePermissions('leads.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move a lead along, and record what was said' })
  update(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: UpdateInviteLeadDto,
  ): Promise<LeadView> {
    return this.leads.update(id, body, staff.id);
  }
}
