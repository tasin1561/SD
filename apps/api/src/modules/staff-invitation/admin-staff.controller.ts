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
import { StaffRole } from '@skydrop/db';
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { requireStaffRoles } from '../../common/auth/require-staff-roles';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../common/types/request';
import { CreateStaffInvitationDto } from './dto/create-staff-invitation.dto';
import { StaffInvitationService } from './services/staff-invitation.service';

/**
 * Admin staff management — invitations + active staff list +
 * role + deactivation. SUPER_ADMIN-only (controller-gated).
 */
@ApiTags('admin-staff')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/staff')
export class AdminStaffController {
  constructor(private readonly svc: StaffInvitationService) {}

  // ── Invitations ────────────────────────────────────────────────────

  @Post('invitations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Invite a new staff member (SUPER_ADMIN only)' })
  createInvitation(
    @Body() body: CreateStaffInvitationDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ) {
    requireStaffRoles(staff, [StaffRole.SUPER_ADMIN]);
    return this.svc.create(body, { staffId: staff.id }, ctx);
  }

  @Get('invitations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List staff invitations' })
  listInvitations(@CurrentStaff() staff: AuthenticatedStaff) {
    requireStaffRoles(staff, [StaffRole.SUPER_ADMIN]);
    return this.svc.list();
  }

  @Post('invitations/:id/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the token + re-issue the invitation link' })
  resendInvitation(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ) {
    requireStaffRoles(staff, [StaffRole.SUPER_ADMIN]);
    return this.svc.resend(id, { staffId: staff.id }, ctx);
  }

  @Delete('invitations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  async revokeInvitation(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    requireStaffRoles(staff, [StaffRole.SUPER_ADMIN]);
    await this.svc.softDelete(id, { staffId: staff.id }, ctx);
  }

  // ── Active staff ───────────────────────────────────────────────────

  @Get('users')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all staff users (active + deactivated)' })
  listStaff(@CurrentStaff() staff: AuthenticatedStaff) {
    requireStaffRoles(staff, [StaffRole.SUPER_ADMIN]);
    return this.svc.listStaff();
  }

  @Patch('users/:id/role')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change a staff member’s role' })
  updateRole(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: { role: StaffRole },
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ) {
    requireStaffRoles(staff, [StaffRole.SUPER_ADMIN]);
    return this.svc.updateRole(id, body.role, { staffId: staff.id }, ctx);
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate a staff user (soft-delete)' })
  async deactivate(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    requireStaffRoles(staff, [StaffRole.SUPER_ADMIN]);
    await this.svc.deactivate(id, { staffId: staff.id }, ctx);
  }
}
