import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import { setStaffRefreshCookie } from '../../common/cookies/auth-cookies';
import { StaffAuthService } from '../staff-auth/staff-auth.service';
import { AcceptStaffInvitationDto } from './dto/accept-staff-invitation.dto';
import { StaffInvitationService } from './services/staff-invitation.service';

interface AccessTokenResponse {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly expiresAt: string;
}

/**
 * Public — the invitee POSTs token + chosen password from the
 * accept-invitation page. Creates the staff user, then issues a
 * fresh session via StaffAuthService.login.
 */
@ApiTags('staff-auth')
@ThrottleKey('email-ip')
@Controller('auth/staff')
export class StaffInvitationPublicController {
  constructor(
    private readonly svc: StaffInvitationService,
    private readonly auth: StaffAuthService,
  ) {}

  @Public()
  @Post('accept-invitation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept a staff invitation by token + password → returns a session',
  })
  async accept(
    @Body() body: AcceptStaffInvitationDto,
    @ClientInfo() ctx: ClientInfoPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponse> {
    const accepted = await this.svc.accept(body.token, body.password, ctx);
    const result = await this.auth.login({ email: accepted.email, password: body.password }, ctx);
    setStaffRefreshCookie(res, result.refresh.token, result.refresh.expiresAt);
    return {
      accessToken: result.accessToken.token,
      expiresIn: result.accessToken.expiresIn,
      expiresAt: result.accessToken.expiresAt.toISOString(),
    };
  }
}
