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
import { ActorType } from '@skydrop/db';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { ChangeStoreMemberRoleDto, InviteStoreUserDto } from '../dto/reseller-store.dto';
import {
  StoreTeamService,
  type StoreInvitationView,
  type StoreMemberView,
  type StoreTeamView,
} from '../services/store-team.service';

/**
 * A reseller store's own team (RS-2). Reads need `team.view`, every write
 * `team.manage`; the store is always the caller's own, from the token.
 * Only an owner may grant, change or remove the owner role, and the last
 * owner can never be moved off it.
 */
@ApiTags('store-team')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('team.view')
@Controller('store/team')
export class StoreTeamController {
  constructor(private readonly team: StoreTeamService) {}

  @Get()
  @ApiOperation({ summary: 'Members, pending invitations and the roles to choose from' })
  get(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<StoreTeamView> {
    return this.team.team(user.storeId);
  }

  @Post('invitations')
  @RequireStorePermissions('team.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Invite a colleague (email only — a credential message)' })
  invite(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: InviteStoreUserDto,
  ): Promise<StoreInvitationView> {
    return this.team.inviteAsStore(user, body);
  }

  @Post('invitations/:invitationId/revoke')
  @RequireStorePermissions('team.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Withdraw a pending invitation' })
  revoke(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('invitationId', new ParseUUIDPipe({ version: '7' })) invitationId: string,
  ): Promise<void> {
    return this.team.revokeInvitation(user.storeId, invitationId, {
      type: ActorType.STORE,
      id: user.id,
      sellerId: user.sellerId,
    });
  }

  @Patch('members/:memberId/role')
  @RequireStorePermissions('team.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change what a colleague may do' })
  changeRole(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('memberId', new ParseUUIDPipe({ version: '7' })) memberId: string,
    @Body() body: ChangeStoreMemberRoleDto,
  ): Promise<StoreMemberView> {
    return this.team.changeRole(user, memberId, body.roleKey);
  }

  @Delete('members/:memberId')
  @RequireStorePermissions('team.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a colleague’s access; their sessions end at once' })
  remove(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('memberId', new ParseUUIDPipe({ version: '7' })) memberId: string,
  ): Promise<void> {
    return this.team.removeMember(user, memberId);
  }
}
