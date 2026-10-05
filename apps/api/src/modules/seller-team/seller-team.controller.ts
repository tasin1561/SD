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
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import {
  CreateTeamInvitationDto,
  SetTeamMemberRoleDto,
  SetTeamMemberRolesDto,
} from './dto/create-team-invitation.dto';
import { SellerTeamService } from './services/seller-team.service';
import { RequireSellerPermissions } from '../../common/auth/require-seller-permissions.decorator';

@ApiTags('seller-team')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('team.view')
@Controller('seller/team')
export class SellerTeamController {
  constructor(private readonly svc: SellerTeamService) {}

  // ── Invitations ────────────────────────────────────────────────────

  @Post('invitations')
  @RequireSellerPermissions('team.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Invite a team member (OWNER + ADMIN only)',
  })
  invite(
    @Body() body: CreateTeamInvitationDto,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ) {
    return this.svc.invite(seller.id, body, { sellerUserId: seller.userId }, ctx);
  }

  @Get('invitations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List team invitations' })
  listInvitations(@CurrentSeller() seller: AuthenticatedSeller) {
    return this.svc.listInvitations(seller.id);
  }

  @Post('invitations/:id/resend')
  @RequireSellerPermissions('team.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend (rotate token) on a pending invitation' })
  resendInvitation(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ) {
    return this.svc.resendInvitation(seller.id, id, { sellerUserId: seller.userId }, ctx);
  }

  @Delete('invitations/:id')
  @RequireSellerPermissions('team.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  async revokeInvitation(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    await this.svc.revokeInvitation(seller.id, id, { sellerUserId: seller.userId }, ctx);
  }

  // ── Members ────────────────────────────────────────────────────────

  @Get('members')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List active + deactivated team members' })
  listMembers(@CurrentSeller() seller: AuthenticatedSeller) {
    return this.svc.listMembers(seller.id, seller.userId);
  }

  /**
   * REPLACES the roles a member holds. The body was an inline
   * `{ roleId: string }` with no DTO and therefore no validation; it is
   * a DTO now, and it takes several roles.
   */
  @Patch('members/:id/roles')
  @RequireSellerPermissions('team.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set which roles a team member holds' })
  setRoles(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: SetTeamMemberRolesDto,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ) {
    return this.svc.setRoles(seller.id, id, body.roleIds, { sellerUserId: seller.userId }, ctx);
  }

  /**
   * TRANSITIONAL single-role form, kept so the seller app keeps working
   * across the deploy that introduces `/roles`. Delete it once the UI
   * sends `roleIds`.
   */
  @Patch('members/:id/role')
  @RequireSellerPermissions('team.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'DEPRECATED — use PATCH members/:id/roles' })
  setOneRole(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: SetTeamMemberRoleDto,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ) {
    return this.svc.setRoles(seller.id, id, [body.roleId], { sellerUserId: seller.userId }, ctx);
  }

  @Delete('members/:id')
  @RequireSellerPermissions('team.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate a team member (soft-delete)' })
  async deactivate(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    await this.svc.deactivate(seller.id, id, { sellerUserId: seller.userId }, ctx);
  }
}
