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
import {
  CreateStaffInvitationDto,
  SetStaffRoleDto,
  SetStaffRolesDto,
} from './dto/create-staff-invitation.dto';
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

  /**
   * REPLACES the set of roles somebody holds — several, because the job
   * functions and the access tiers are two axes and a person can sit on
   * both. The body was an inline `{ roleId: string }` with no DTO and
   * therefore no validation at all; it is a DTO now.
   */
  @Patch('users/:id/roles')
  @RequirePermissions('staff.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set which roles a staff member holds (ids, custom roles included)' })
  setRoles(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: SetStaffRolesDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ) {
    return this.svc.setRoles(id, body.roleIds, { staffId: staff.id }, ctx);
  }

  /**
   * TRANSITIONAL single-role form, kept so the admin app keeps working
   * across the deploy that introduces `/roles`. One role is a valid
   * special case of "set the roles", so it delegates rather than
   * duplicating the guards. Delete it once the UI sends `roleIds`.
   */
  @Patch('users/:id/role')
  @RequirePermissions('staff.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'DEPRECATED — use PATCH users/:id/roles' })
  setOneRole(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: SetStaffRoleDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ) {
    return this.svc.setRoles(id, [body.roleId], { staffId: staff.id }, ctx);
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
