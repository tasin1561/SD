import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { UpdateSellerProfileDto } from './dto/update-profile.dto';
import { UpdateSellerBankDetailsDto } from './dto/update-bank-details.dto';
import { SellerProfileService, type SellerProfileView } from './services/seller-profile.service';
import { SellerLogoService } from './services/seller-logo.service';
import { RequireSellerPermissions } from '../../common/auth/require-seller-permissions.decorator';

const ALLOWED_LOGO_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
type AllowedLogoMime = (typeof ALLOWED_LOGO_MIME)[number];

class PresignLogoDto {
  @ApiProperty({ enum: ALLOWED_LOGO_MIME })
  @IsString()
  @IsIn(ALLOWED_LOGO_MIME as unknown as readonly string[])
  mimeType!: AllowedLogoMime;
}

class RegisterLogoDto {
  @ApiProperty({ description: 'storageKey returned by /logo/presign' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  storageKey!: string;

  @ApiProperty({ enum: ALLOWED_LOGO_MIME })
  @IsString()
  @IsIn(ALLOWED_LOGO_MIME as unknown as readonly string[])
  mimeType!: AllowedLogoMime;
}

@ApiTags('seller-profile')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('profile.view')
@Controller('seller/profile')
export class SellerProfileController {
  constructor(
    private readonly svc: SellerProfileService,
    private readonly logoSvc: SellerLogoService,
  ) {}

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get the authenticated seller profile + onboarding progress',
    description: 'Allowed for SUSPENDED sellers (read-only access).',
  })
  getProfile(@CurrentSeller() seller: AuthenticatedSeller): Promise<SellerProfileView> {
    return this.svc.getProfile(seller.id);
  }

  @Patch()
  @RequireSellerPermissions('profile.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update profile fields (APPROVED sellers only)' })
  updateProfile(
    @Body() body: UpdateSellerProfileDto,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<SellerProfileView> {
    return this.svc.updateProfile(seller.id, body, ctx);
  }

  @Patch('bank-details')
  @RequireSellerPermissions('profile.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update bank details (APPROVED sellers only)',
    description:
      'Phase 1B feature surface — captures the data; remittance and KYC checks land in 1B.',
  })
  updateBankDetails(
    @Body() body: UpdateSellerBankDetailsDto,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<SellerProfileView> {
    return this.svc.updateBankDetails(seller.id, body, ctx);
  }

  @Post('logo/presign')
  @RequireSellerPermissions('profile.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Presign a PUT URL for uploading the company logo',
    description:
      'Returns storageKey + presigned PUT URL; client PUTs the file then POSTs /logo/register.',
  })
  presignLogo(@Body() body: PresignLogoDto, @CurrentSeller() seller: AuthenticatedSeller) {
    return this.logoSvc.presign(seller.id, body.mimeType);
  }

  @Post('logo/register')
  @RequireSellerPermissions('profile.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register an uploaded logo (called after the presigned PUT succeeds)',
  })
  registerLogo(
    @Body() body: RegisterLogoDto,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ) {
    return this.logoSvc.register(seller.id, body.storageKey, body.mimeType, ctx);
  }

  @Delete('logo')
  @RequireSellerPermissions('profile.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove the company logo' })
  removeLogo(@CurrentSeller() seller: AuthenticatedSeller, @ClientInfo() ctx: ClientInfoPayload) {
    return this.logoSvc.remove(seller.id, ctx);
  }
}
