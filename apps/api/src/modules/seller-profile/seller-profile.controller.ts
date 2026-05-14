import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { UpdateSellerProfileDto } from './dto/update-profile.dto';
import { UpdateSellerBankDetailsDto } from './dto/update-bank-details.dto';
import { SellerProfileService, type SellerProfileView } from './services/seller-profile.service';

@ApiTags('seller-profile')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@Controller('seller/profile')
export class SellerProfileController {
  constructor(private readonly svc: SellerProfileService) {}

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
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update bank details (APPROVED sellers only)',
    description: 'Phase 1B feature surface — captures the data; remittance and KYC checks land in 1B.',
  })
  updateBankDetails(
    @Body() body: UpdateSellerBankDetailsDto,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<SellerProfileView> {
    return this.svc.updateBankDetails(seller.id, body, ctx);
  }
}
