import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { CurrentStoreUser } from '../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../common/guards/store-jwt.guard';
import { StoreSelfService } from '../../common/auth/require-store-permissions.decorator';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../common/types/request';
import {
  STORE_REFRESH_COOKIE,
  clearStoreRefreshCookie,
  setStoreRefreshCookie,
} from '../../common/cookies/auth-cookies';
import { JwtService } from '../auth-common/services/jwt.service';
import { RefreshTokenService } from '../auth-common/services/refresh-token.service';
import {
  StoreAcceptInvitationDto,
  StoreLoginDto,
  StorePasswordResetConfirmDto,
  StorePasswordResetRequestDto,
  StoreTokenDto,
} from './dto/store-auth.dto';
import { StoreAuthService, type StoreMe, type StoreSession } from './store-auth.service';

interface AccessTokenResponse {
  accessToken: string;
  expiresIn: number;
  expiresAt: string;
}

/**
 * RS-2 — `/auth/store/*`, the reseller store portal's session surface.
 *
 * The seller auth controller's twin: same throttles (login 5 per 15
 * minutes keyed on email + IP), same `__Host-` cookie shape, same hybrid
 * read-only `/me` (FE-4). Self-service by construction — every endpoint
 * here is about the caller's own session or credential.
 */
@ApiTags('auth-store')
@StoreSelfService()
@Controller('auth/store')
@ThrottleKey('auth-user')
export class StoreAuthController {
  constructor(
    private readonly svc: StoreAuthService,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @ThrottleKey('email-ip')
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Store user login (the store must be open and its seller approved)' })
  async login(
    @Body() body: StoreLoginDto,
    @ClientInfo() ctx: ClientInfoPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponse> {
    return this.session(res, await this.svc.login(body, ctx));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the store refresh cookie and issue a new access token' })
  async refresh(
    @Req() req: Request,
    @ClientInfo() ctx: ClientInfoPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponse> {
    return this.session(res, await this.svc.rotateRefresh(readRefreshCookie(req), ctx));
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke this store session and clear the cookie' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.svc.logout(readRefreshCookie(req));
    clearStoreRefreshCookie(res);
  }

  @UseGuards(StoreJwtGuard)
  @ApiBearerAuth('store-jwt')
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke every session of the signed-in store user' })
  async logoutAll(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ revokedCount: number }> {
    const result = await this.svc.logoutAll(user.id, user.sellerId);
    clearStoreRefreshCookie(res);
    return result;
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  @ThrottleKey('email')
  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a password reset email (generic 200 either way)' })
  passwordResetRequest(
    @Body() body: StorePasswordResetRequestDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ message: string }> {
    return this.svc.requestPasswordReset(body, ctx);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60 * 60 * 1000 } })
  @ThrottleKey('ip')
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new password with a valid reset token' })
  async passwordResetConfirm(
    @Body() body: StorePasswordResetConfirmDto,
    @ClientInfo() ctx: ClientInfoPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const result = await this.svc.confirmPasswordReset(body, ctx);
    clearStoreRefreshCookie(res);
    return result;
  }

  @UseGuards(StoreJwtGuard)
  @ApiBearerAuth('store-jwt')
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  @Post('email-verification/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Email a verification link to the signed-in store user' })
  emailVerificationRequest(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ ok: true }> {
    return this.svc.requestEmailVerification(user.id, ctx);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60 * 60 * 1000 } })
  @ThrottleKey('ip')
  @Post('email-verification/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm an email verification token' })
  emailVerificationConfirm(
    @Body() body: StoreTokenDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ ok: true }> {
    return this.svc.confirmEmailVerification(body, ctx);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60 * 60 * 1000 } })
  @ThrottleKey('ip')
  @Post('invitations/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'What an invitation is for (store, role, email). POST so the token never sits in a URL or an access log.',
  })
  previewInvitation(
    @Body() body: StoreTokenDto,
  ): ReturnType<StoreAuthService['previewInvitation']> {
    return this.svc.previewInvitation(body.token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60 * 60 * 1000 } })
  @ThrottleKey('ip')
  @Post('invitations/accept')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Accept a store invitation: create the login and sign in' })
  async acceptInvitation(
    @Body() body: StoreAcceptInvitationDto,
    @ClientInfo() ctx: ClientInfoPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponse> {
    return this.session(res, await this.svc.acceptInvitation(body, ctx));
  }

  /**
   * Hybrid auth (FE-4): the bearer token OR the `__Host-storeRefresh`
   * cookie. The cookie path is READ-ONLY — `validateByPlaintext`, never a
   * rotation — so the SSR boot can never race the client's refresh.
   */
  @Public()
  @Get('me')
  @ApiBearerAuth('store-jwt')
  @ApiOperation({
    summary: 'The signed-in store user and their store (bearer or cookie, read-only)',
  })
  async me(@Req() req: Request): Promise<StoreMe> {
    const storeUserId = await this.resolveStoreUserId(req);
    await this.svc.assertMayUse(storeUserId);
    return this.svc.getMe(storeUserId);
  }

  private async resolveStoreUserId(req: Request): Promise<string> {
    const bearer = extractBearer(req.header('authorization'));
    if (bearer !== null) return this.jwt.verifyStoreAccess(bearer).sub;
    const cookie = readRefreshCookie(req);
    if (!cookie) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Bearer token or __Host-storeRefresh cookie required',
      });
    }
    const validated = await this.refreshTokens.validateByPlaintext('store', cookie);
    if (!validated) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired refresh session',
      });
    }
    return validated.userId;
  }

  private session(res: Response, s: StoreSession): AccessTokenResponse {
    setStoreRefreshCookie(res, s.refresh.token, s.refresh.expiresAt);
    return {
      accessToken: s.accessToken.token,
      expiresIn: s.accessToken.expiresIn,
      expiresAt: s.accessToken.expiresAt.toISOString(),
    };
  }
}

function readRefreshCookie(req: Request): string {
  const raw = (req.cookies as Record<string, string | undefined> | undefined)?.[
    STORE_REFRESH_COOKIE
  ];
  return typeof raw === 'string' ? raw : '';
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? null;
}
