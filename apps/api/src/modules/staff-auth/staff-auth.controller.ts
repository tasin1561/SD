import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import type { AuthenticatedStaff } from '../../common/types/request';
import {
  STAFF_REFRESH_COOKIE,
  clearStaffRefreshCookie,
  setStaffRefreshCookie,
} from '../../common/cookies/auth-cookies';
import { StaffLoginDto } from './dto/login.dto';
import {
  StaffPasswordResetConfirmDto,
  StaffPasswordResetRequestDto,
} from './dto/password-reset.dto';
import { StaffEmailVerificationConfirmDto } from './dto/email-verification.dto';
import { StaffAuthService } from './staff-auth.service';

interface AccessTokenResponse {
  accessToken: string;
  expiresIn: number;
  expiresAt: string;
}

@ApiTags('auth-staff')
@Controller('auth/staff')
export class StaffAuthController {
  constructor(private readonly svc: StaffAuthService) {}

  // ---------- LOGIN ----------

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Staff login with email + password' })
  @ApiBody({ type: StaffLoginDto })
  @ApiResponse({ status: 200, description: 'Access token issued; refresh cookie set' })
  @ApiResponse({ status: 401, description: 'Invalid credentials (generic — does not disclose user existence)' })
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
  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a password reset email (generic 200 regardless of email existence)' })
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

  @UseGuards(StaffJwtGuard)
  @ApiBearerAuth('staff-jwt')
  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Return the authenticated staff profile' })
  async me(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.svc.getMe(staff.id);
  }
}

function readRefreshCookie(req: Request): string {
  const raw = (req.cookies as Record<string, string | undefined> | undefined)?.[STAFF_REFRESH_COOKIE];
  return typeof raw === 'string' ? raw : '';
}
