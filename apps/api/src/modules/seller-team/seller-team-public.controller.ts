import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import { setSellerRefreshCookie } from '../../common/cookies/auth-cookies';
import { SellerAuthService } from '../seller-auth/seller-auth.service';
import { SellerTeamService } from './services/seller-team.service';

class AcceptDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  token!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12)
  @MaxLength(256)
  password!: string;

  @ApiProperty({ minLength: 1, maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName!: string;
}

interface AccessTokenResponse {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly expiresAt: string;
}

/**
 * Public — the invitee submits token + password + their display name.
 * Creates the SellerUser, then signs them in.
 */
@ApiTags('seller-auth')
@ThrottleKey('email-ip')
@Controller('auth/seller')
export class SellerTeamPublicController {
  constructor(
    private readonly svc: SellerTeamService,
    private readonly auth: SellerAuthService,
  ) {}

  @Public()
  @Post('accept-team-invitation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept a team invitation by token + password → returns a session',
  })
  async accept(
    @Body() body: AcceptDto,
    @ClientInfo() ctx: ClientInfoPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponse> {
    const accepted = await this.svc.accept(body.token, body.password, body.fullName, ctx);
    const result = await this.auth.login({ email: accepted.email, password: body.password }, ctx);
    setSellerRefreshCookie(res, result.refresh.token, result.refresh.expiresAt);
    return {
      accessToken: result.accessToken.token,
      expiresIn: result.accessToken.expiresIn,
      expiresAt: result.accessToken.expiresAt.toISOString(),
    };
  }
}
