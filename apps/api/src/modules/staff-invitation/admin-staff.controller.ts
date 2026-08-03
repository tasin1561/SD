import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../common/types/request';
import { CreateStaffInvitationDto } from './dto/create-staff-invitation.dto';
import { StaffInvitationService } from './services/staff-invitation.service';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';

/**
 * Admin staff management — invitations + active staff list +
 * role + deactivation. SUPER_ADMIN-only (controller-gated).
 */
@ApiTags('admin-staff')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('staff.view')
@Controller('admin/staff')
export class AdminStaffController {
  constructor(private readonly svc: StaffInvitationService) {}

  // ── Invitations ────────────────────────────────────────────────────

  @Post('invitations')
  @RequirePermissions('staff.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Invite a new staff member (SUPER_ADMIN only)' })
  createInvitation(
    @Body() body: CreateStaffInvitationDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ) {
    return this.svc.create(body, { staffId: staff.id }, ctx);
  }

  @Get('invitations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List staff invitations' })
  listInvitations() {
    return this.svc.list();
  }

  @Post('invitations/:id/resend')
  @RequirePermissions('staff.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the token + re-issue the invitation link' })
  resendInvitation(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ) {
    return this.svc.resend(id, { staffId: staff.id }, ctx);
  }

  @Delete('invitations/:id')
  @RequirePermissions('staff.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  async revokeInvitation(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    await this.svc.softDelete(id, { staffId: staff.id }, ctx);
  }

  // ── Active staff ───────────────────────────────────────────────────

  @Get('users')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all staff users (active + deactivated)' })
  listStaff() {
    return this.svc.listStaff();
  }

  @Patch('users/:id/role')
  @RequirePermissions('staff.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move a staff member to a role (by role id, including custom roles)' })
  updateRole(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: { roleId: string },
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ) {
    return this.svc.updateRole(id, body.roleId, { staffId: staff.id }, ctx);
  }

  @Delete('users/:id')
  @RequirePermissions('staff.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate a staff user (soft-delete)' })
  async deactivate(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    await this.svc.deactivate(id, { staffId: staff.id }, ctx);
  }
}
