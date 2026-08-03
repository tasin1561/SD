import {
  Body,
  Controller,
  Delete,
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
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../common/types/request';
import { CreateSellerInvitationDto } from './dto/create.dto';
import {
  CreatedInvitationDto,
  InvitationListResponseDto,
  ListSellerInvitationsQueryDto,
} from './dto/list.dto';
import { SellerInvitationService } from './seller-invitation.service';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';

/**
 * Admin endpoints — every method requires a valid staff JWT.
 *
 * Phase 1A note: any authenticated staff member may invite/list/resend/
 * delete. Role-based scoping (SUPER_ADMIN + SELLER_APPROVAL_ADMIN only)
 * lands with the RBAC module.
 */
@ApiTags('admin-seller-invitations')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('sellers.view')
@Controller('admin/seller-invitations')
export class SellerInvitationAdminController {
  constructor(private readonly svc: SellerInvitationService) {}

  @Post()
  @RequirePermissions('sellers.invite')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a seller invitation and email the plaintext token' })
  create(
    @Body() body: CreateSellerInvitationDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CreatedInvitationDto> {
    return this.svc.create(body, { staffId: staff.id }, ctx);
  }

  @Get()
  @ApiOperation({ summary: 'Paginated list of invitations with optional filters' })
  list(@Query() query: ListSellerInvitationsQueryDto): Promise<InvitationListResponseDto> {
    return this.svc.list(query);
  }

  @Post(':id/resend')
  @RequirePermissions('sellers.invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the token and re-send the invitation email' })
  resend(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CreatedInvitationDto> {
    return this.svc.resend(id, { staffId: staff.id }, ctx);
  }

  @Delete(':id')
  @RequirePermissions('sellers.invite')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a PENDING invitation' })
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    await this.svc.softDelete(id, { staffId: staff.id }, ctx);
  }
}
