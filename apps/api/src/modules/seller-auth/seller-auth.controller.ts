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
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import type { AuthenticatedSeller } from '../../common/types/request';
import {
  SELLER_REFRESH_COOKIE,
  clearSellerRefreshCookie,
  setSellerRefreshCookie,
} from '../../common/cookies/auth-cookies';
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
export class SellerAuthController {
  constructor(private readonly svc: SellerAuthService) {}

  // ---------- REGISTER VIA INVITATION ----------

  @Public()
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
  @Post('email-verification/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request an email verification link for the authenticated seller' })
  async emailVerificationRequest(
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ ok: true }> {
    return this.svc.requestEmailVerification(seller.id, ctx);
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

  @UseGuards(SellerJwtGuard)
  @ApiBearerAuth('seller-jwt')
  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Return the authenticated seller profile' })
  async me(@CurrentSeller() seller: AuthenticatedSeller): Promise<SellerMe> {
    return this.svc.getMe(seller.id);
  }
}

function readRefreshCookie(req: Request): string {
  const raw = (req.cookies as Record<string, string | undefined> | undefined)?.[SELLER_REFRESH_COOKIE];
  return typeof raw === 'string' ? raw : '';
}
