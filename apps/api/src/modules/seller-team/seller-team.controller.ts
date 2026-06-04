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
import { SellerUserRole } from '@skydrop/db';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../common/decorators/client-info.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { requireSellerRoles } from '../../common/auth/require-seller-roles';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { CreateTeamInvitationDto } from './dto/create-team-invitation.dto';
import { SellerTeamService } from './services/seller-team.service';

@ApiTags('seller-team')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@Controller('seller/team')
export class SellerTeamController {
  constructor(private readonly svc: SellerTeamService) {}

  // ── Invitations ────────────────────────────────────────────────────

  @Post('invitations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Invite a team member (OWNER + ADMIN only)',
  })
  invite(
    @Body() body: CreateTeamInvitationDto,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ) {
    requireSellerRoles(seller, [SellerUserRole.OWNER, SellerUserRole.ADMIN]);
    return this.svc.invite(seller.id, body, { sellerUserId: seller.userId }, ctx);
  }

  @Get('invitations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List team invitations' })
  listInvitations(@CurrentSeller() seller: AuthenticatedSeller) {
    return this.svc.listInvitations(seller.id);
  }

  @Post('invitations/:id/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend (rotate token) on a pending invitation' })
  resendInvitation(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ) {
    requireSellerRoles(seller, [SellerUserRole.OWNER, SellerUserRole.ADMIN]);
    return this.svc.resendInvitation(seller.id, id, { sellerUserId: seller.userId }, ctx);
  }

  @Delete('invitations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  async revokeInvitation(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    requireSellerRoles(seller, [SellerUserRole.OWNER, SellerUserRole.ADMIN]);
    await this.svc.revokeInvitation(seller.id, id, { sellerUserId: seller.userId }, ctx);
  }

  // ── Members ────────────────────────────────────────────────────────

  @Get('members')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List active + deactivated team members' })
  listMembers(@CurrentSeller() seller: AuthenticatedSeller) {
    return this.svc.listMembers(seller.id, seller.userId);
  }

  @Patch('members/:id/role')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change a team member’s role' })
  updateRole(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: { role: SellerUserRole },
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ) {
    requireSellerRoles(seller, [SellerUserRole.OWNER, SellerUserRole.ADMIN]);
    return this.svc.updateRole(seller.id, id, body.role, { sellerUserId: seller.userId }, ctx);
  }

  @Delete('members/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate a team member (soft-delete)' })
  async deactivate(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    requireSellerRoles(seller, [SellerUserRole.OWNER, SellerUserRole.ADMIN]);
    await this.svc.deactivate(seller.id, id, { sellerUserId: seller.userId }, ctx);
  }
}
