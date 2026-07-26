import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ActorType, SellerStatus } from '@skydrop/db';
import type { Request, Response } from 'express';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import {
  SELLER_REFRESH_COOKIE,
  clearSellerRefreshCookie,
  setSellerRefreshCookie,
} from '../../common/cookies/auth-cookies';
import { JwtService } from '../auth-common/services/jwt.service';
import { RefreshTokenService } from '../auth-common/services/refresh-token.service';
import { AuditLogService } from '../auth-common/services/audit-log.service';
import {
  SellerRoles,
  SELLER_ROLES_ALL,
} from '../../common/decorators/seller-roles.decorator';
import { SellerLoginDto } from './dto/login.dto';
import {
  SellerPasswordResetConfirmDto,
  SellerPasswordResetRequestDto,
} from './dto/password-reset.dto';
import { SellerEmailVerificationConfirmDto } from './dto/email-verification.dto';
import { SellerRegisterViaInvitationDto } from './dto/register-via-invitation.dto';
import { SellerAuthService, type SellerMe } from './seller-auth.service';

interface AccessTokenResponse {
  accessToken: string;
  expiresIn: number;
  expiresAt: string;
}

@ApiTags('auth-seller')
@Controller('auth/seller')
@ThrottleKey('auth-user')
export class SellerAuthController {
  constructor(
    private readonly svc: SellerAuthService,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // ---------- REGISTER VIA INVITATION ----------

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60 * 60 * 1000 } })
  @ThrottleKey('ip')
  @Post('register/invite')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Consume an invitation token, create the seller (APPROVED), and log them in',
  })
  @ApiBody({ type: SellerRegisterViaInvitationDto })
  async registerViaInvitation(
    @Body() body: SellerRegisterViaInvitationDto,
    @ClientInfo() ctx: ClientInfoPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponse & { seller: { id: string; email: string; status: string } }> {
    const result = await this.svc.registerViaInvitation(body, ctx);
    setSellerRefreshCookie(res, result.refresh.token, result.refresh.expiresAt);
    return {
      accessToken: result.accessToken.token,
      expiresIn: result.accessToken.expiresIn,
      expiresAt: result.accessToken.expiresAt.toISOString(),
      seller: result.seller,
    };
  }

  // ---------- LOGIN ----------

  @Public()
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @ThrottleKey('email-ip')
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Seller login with email + password (APPROVED status required)' })
  @ApiResponse({ status: 200, description: 'Access token issued; refresh cookie set' })
  @ApiResponse({ status: 401, description: 'Invalid credentials (generic)' })
  @ApiResponse({ status: 403, description: 'Account not active (PENDING/REJECTED/SUSPENDED)' })
  async login(
    @Body() body: SellerLoginDto,
    @ClientInfo() ctx: ClientInfoPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponse> {
    const result = await this.svc.login(body, ctx);
    setSellerRefreshCookie(res, result.refresh.token, result.refresh.expiresAt);
    return {
      accessToken: result.accessToken.token,
      expiresIn: result.accessToken.expiresIn,
      expiresAt: result.accessToken.expiresAt.toISOString(),
    };
  }

  // ---------- REFRESH ----------

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token (cookie) and issue a new access token' })
  async refresh(
    @Req() req: Request,
    @ClientInfo() ctx: ClientInfoPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponse> {
    const cookie = readRefreshCookie(req);
    const result = await this.svc.rotateRefresh({ plaintext: cookie }, ctx);
    setSellerRefreshCookie(res, result.refresh.token, result.refresh.expiresAt);
    return {
      accessToken: result.accessToken.token,
      expiresIn: result.accessToken.expiresIn,
      expiresAt: result.accessToken.expiresAt.toISOString(),
    };
  }

  // ---------- LOGOUT ----------

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the current refresh session and clear the cookie' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const cookie = readRefreshCookie(req);
    await this.svc.logout({ refreshPlaintext: cookie, sellerId: req.seller?.id ?? null });
    clearSellerRefreshCookie(res);
  }

  @UseGuards(SellerJwtGuard)
  @ApiBearerAuth('seller-jwt')
  // Self-service: EVERY role must be able to end their own sessions.
  @SellerRoles(...SELLER_ROLES_ALL)
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke every active refresh session for the seller' })
  async logoutAll(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ revokedCount: number }> {
    const result = await this.svc.logoutAll(seller.id);
    clearSellerRefreshCookie(res);
    return result;
  }

  // ---------- PASSWORD RESET ----------

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  @ThrottleKey('email')
  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a password reset email (generic 200 regardless of email existence)' })
  async passwordResetRequest(
    @Body() body: SellerPasswordResetRequestDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ message: string }> {
    return this.svc.requestPasswordReset(body, ctx);
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new password using a valid reset token' })
  async passwordResetConfirm(
    @Body() body: SellerPasswordResetConfirmDto,
    @ClientInfo() ctx: ClientInfoPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const result = await this.svc.confirmPasswordReset(body, ctx);
    clearSellerRefreshCookie(res);
    return result;
  }

  // ---------- EMAIL VERIFICATION ----------

  @UseGuards(SellerJwtGuard)
  @ApiBearerAuth('seller-jwt')
  // Self-service: EVERY role must be able to verify their own email.
  @SellerRoles(...SELLER_ROLES_ALL)
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  @ThrottleKey('auth-user')
  @Post('email-verification/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request an email verification link for the authenticated seller' })
  async emailVerificationRequest(
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ ok: true }> {
    return this.svc.requestEmailVerification(seller.userId, ctx);
  }

  @Public()
  @Post('email-verification/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm an email verification token' })
  async emailVerificationConfirm(
    @Body() body: SellerEmailVerificationConfirmDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ ok: true }> {
    return this.svc.confirmEmailVerification(body, ctx);
  }

  // ---------- ME ----------

  /**
   * Hybrid auth (Module 12 / Decision #1): accepts EITHER the
   * `Authorization: Bearer <access>` token OR the
   * `__Host-sellerRefresh` cookie. Bearer wins when both are present.
   * The cookie path uses `RefreshTokenService.validateByPlaintext` —
   * read-only, no rotation, no family-burn on revoked tokens (see
   * StaffAuthController.me JSDoc for the full rationale). Mirrors the
   * staff path for symmetry.
   */
  @Public()
  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('seller-jwt')
  @ApiOperation({
    summary:
      'Authenticated seller profile — accepts bearer access token OR __Host-sellerRefresh cookie (cookie path is read-only, no rotation)',
  })
  async me(@Req() req: Request): Promise<SellerMe> {
    const sellerUserId = await this.resolveSellerUserId(req);
    // Status recheck — preserves the existing SellerJwtGuard semantics
    // (suspended sellers 403 on /me; PENDING/REJECTED never pass). The
    // guard is bypassed for the hybrid route, so we re-implement the
    // check inline against either auth path. Audit the denial first so
    // it survives a downstream response failure.
    await this.assertActiveSeller(sellerUserId, req);
    return this.svc.getMe(sellerUserId);
  }

  private async resolveSellerUserId(req: Request): Promise<string> {
    const bearer = extractBearer(req.header('authorization'));
    if (bearer !== null) {
      const claims = this.jwt.verifySellerAccess(bearer);
      return claims.sub;
    }
    const cookie = readRefreshCookie(req);
    if (!cookie) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Bearer token or __Host-sellerRefresh cookie required',
      });
    }
    const validated = await this.refreshTokens.validateByPlaintext('seller', cookie);
    if (!validated) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired refresh session',
      });
    }
    return validated.userId;
  }

  /** Mirrors SellerJwtGuard's status recheck on the hybrid /me path
   *  (the guard is bypassed here so we run the check inline). /me is
   *  not @SellerAuthAllowSuspended — SUSPENDED returns 403, same as
   *  the previous bearer-only behavior. Phase 1B: the auth path now
   *  identifies a SellerUser; we join through to the parent Seller. */
  private async assertActiveSeller(sellerUserId: string, req: Request): Promise<void> {
    const user = await this.prisma.client.sellerUser.findFirst({
      where: { id: sellerUserId, deletedAt: null },
      select: {
        id: true,
        seller: { select: { id: true, status: true, deletedAt: true } },
      },
    });
    if (!user || user.seller.deletedAt !== null) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Seller session no longer valid',
      });
    }
    if (user.seller.status !== SellerStatus.APPROVED) {
      await this.audit.log({
        actorType: ActorType.SELLER,
        sellerId: user.seller.id,
        action: 'seller.access_denied_status',
        entityType: 'seller',
        entityId: user.seller.id,
        metadata: {
          status: user.seller.status,
          path: req.url,
          method: req.method,
          ipAddress: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
        },
        severity: 'MEDIUM',
      });
      throw new ForbiddenException({
        code: 'ACCOUNT_NOT_ACTIVE',
        message: 'Account not active. Contact support.',
      });
    }
  }
}

function readRefreshCookie(req: Request): string {
  const raw = (req.cookies as Record<string, string | undefined> | undefined)?.[SELLER_REFRESH_COOKIE];
  return typeof raw === 'string' ? raw : '';
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? null;
}
