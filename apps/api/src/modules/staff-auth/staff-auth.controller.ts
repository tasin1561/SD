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
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../common/types/request';
import {
  STAFF_REFRESH_COOKIE,
  clearStaffRefreshCookie,
  setStaffRefreshCookie,
} from '../../common/cookies/auth-cookies';
import { JwtService } from '../auth-common/services/jwt.service';
import { RefreshTokenService } from '../auth-common/services/refresh-token.service';
import { StaffLoginDto } from './dto/login.dto';
import {
  StaffPasswordResetConfirmDto,
  StaffPasswordResetRequestDto,
} from './dto/password-reset.dto';
import { StaffEmailVerificationConfirmDto } from './dto/email-verification.dto';
import { StaffAuthService } from './staff-auth.service';
import { StaffSelfService } from '../../common/auth/require-permissions.decorator';

interface AccessTokenResponse {
  accessToken: string;
  expiresIn: number;
  expiresAt: string;
}

@ApiTags('auth-staff')
@StaffSelfService()
@Controller('auth/staff')
@ThrottleKey('auth-user')
export class StaffAuthController {
  constructor(
    private readonly svc: StaffAuthService,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  // ---------- LOGIN ----------

  @Public()
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @ThrottleKey('email-ip')
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Staff login with email + password' })
  @ApiBody({ type: StaffLoginDto })
  @ApiResponse({ status: 200, description: 'Access token issued; refresh cookie set' })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials (generic — does not disclose user existence)',
  })
  async login(
    @Body() body: StaffLoginDto,
    @ClientInfo() ctx: ClientInfoPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponse> {
    const result = await this.svc.login(body, ctx);
    setStaffRefreshCookie(res, result.refresh.token, result.refresh.expiresAt);
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
    setStaffRefreshCookie(res, result.refresh.token, result.refresh.expiresAt);
    return {
      accessToken: result.accessToken.token,
      expiresIn: result.accessToken.expiresIn,
      expiresAt: result.accessToken.expiresAt.toISOString(),
    };
  }

  // ---------- LOGOUT ----------

  /**
   * Logout is public so an unauthenticated request bearing only the cookie
   * still clears its session cleanly (e.g., after an access-token expiry
   * the client wants to log out). We pull the staffId from the bearer if it's
   * present and valid, but don't require it.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the current refresh session and clear the cookie' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const cookie = readRefreshCookie(req);
    await this.svc.logout({ refreshPlaintext: cookie, staffId: req.staff?.id ?? null });
    clearStaffRefreshCookie(res);
  }

  @UseGuards(StaffJwtGuard)
  @ApiBearerAuth('staff-jwt')
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke every active refresh session for the staff user' })
  async logoutAll(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ revokedCount: number }> {
    const result = await this.svc.logoutAll(staff.id);
    clearStaffRefreshCookie(res);
    return result;
  }

  // ---------- PASSWORD RESET ----------

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  @ThrottleKey('email')
  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a password reset email (generic 200 regardless of email existence)',
  })
  async passwordResetRequest(
    @Body() body: StaffPasswordResetRequestDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ message: string }> {
    return this.svc.requestPasswordReset(body, ctx);
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new password using a valid reset token' })
  async passwordResetConfirm(
    @Body() body: StaffPasswordResetConfirmDto,
    @ClientInfo() ctx: ClientInfoPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const result = await this.svc.confirmPasswordReset(body, ctx);
    // Belt-and-braces — confirm flow already revokes refresh tokens; also
    // clear the cookie on this client so subsequent requests don't carry a
    // dead refresh token.
    clearStaffRefreshCookie(res);
    return result;
  }

  // ---------- EMAIL VERIFICATION ----------

  @UseGuards(StaffJwtGuard)
  @ApiBearerAuth('staff-jwt')
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  @ThrottleKey('auth-user')
  @Post('email-verification/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request an email verification link for the authenticated staff' })
  async emailVerificationRequest(
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ ok: true }> {
    return this.svc.requestEmailVerification(staff.id, ctx);
  }

  @Public()
  @Post('email-verification/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm an email verification token' })
  async emailVerificationConfirm(
    @Body() body: StaffEmailVerificationConfirmDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ ok: true }> {
    return this.svc.confirmEmailVerification(body, ctx);
  }

  // ---------- ME ----------

  /**
   * Hybrid auth (Module 12 / Decision #1): accepts EITHER the
   * `Authorization: Bearer <access>` token (client-side, the existing
   * flow) OR the `__Host-staffRefresh` cookie (server-side SSR, the
   * Next.js admin app's authenticated-page boot path).
   *
   * Bearer wins when both are present. The cookie path uses the
   * READ-ONLY `RefreshTokenService.validateByPlaintext` — strictly
   * distinct from `rotate()`:
   *   - This handler NEVER calls rotate(); the cookie passes through
   *     untouched, with no Set-Cookie on the response.
   *   - A revoked cookie returns 401 here WITHOUT firing the
   *     reuse-detection family-burn. The family-burn is reserved for
   *     the consumption path (`POST /refresh`) where presenting a
   *     revoked token is unambiguous replay; presenting the same
   *     token to /me repeatedly is validation, not replay.
   *
   * This non-rotating property is the load-bearing detail of the
   * SSR-auth model: the client owns rotation (silent-refresh on 401);
   * the server-component path never rotates so it can never race the
   * client's own rotation and burn its session.
   *
   * Marked `@Public()` so `StaffJwtGuard` does NOT auto-reject when a
   * bearer is absent — handler does its own resolution.
   */
  @Public()
  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('staff-jwt')
  @ApiOperation({
    summary:
      'Authenticated staff profile — accepts bearer access token OR __Host-staffRefresh cookie (cookie path is read-only, no rotation)',
  })
  async me(@Req() req: Request) {
    const staffId = await this.resolveStaffId(req);
    return this.svc.getMe(staffId);
  }

  /**
   * Resolution order: bearer wins. The `JwtService.verifyStaffAccess`
   * call throws on invalid bearer (signature/expiry/audience); we
   * deliberately do NOT fall back to the cookie when the bearer is
   * malformed — that would mask client bugs and let a stale bearer
   * silently elevate to a cookie-derived identity. Only an ABSENT
   * bearer triggers the cookie path.
   */
  private async resolveStaffId(req: Request): Promise<string> {
    const bearer = extractBearer(req.header('authorization'));
    if (bearer !== null) {
      // Throws UnauthorizedException on invalid bearer — surface as 401.
      const claims = this.jwt.verifyStaffAccess(bearer);
      return claims.sub;
    }
    const cookie = readRefreshCookie(req);
    if (!cookie) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Bearer token or __Host-staffRefresh cookie required',
      });
    }
    const validated = await this.refreshTokens.validateByPlaintext('staff', cookie);
    if (!validated) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired refresh session',
      });
    }
    return validated.userId;
  }
}

function readRefreshCookie(req: Request): string {
  const raw = (req.cookies as Record<string, string | undefined> | undefined)?.[
    STAFF_REFRESH_COOKIE
  ];
  return typeof raw === 'string' ? raw : '';
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? null;
}
