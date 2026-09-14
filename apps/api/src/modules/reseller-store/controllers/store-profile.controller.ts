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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import {
  PresignStoreLogoDto,
  RegisterStoreLogoDto,
  UpdateStoreProfileDto,
} from '../dto/reseller-store.dto';
import {
  StoreProfileService,
  type StoreLogoPresign,
  type StoreProfileView,
} from '../services/store-profile.service';

/**
 * A reseller store's own profile (RS-1 / RS-10) — the display name the
 * customer will see, the logo, the contact details. Always the caller's
 * OWN store: the id comes from the token, never the request.
 */
@ApiTags('store-profile')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('store.profile.view')
@Controller('store/profile')
export class StoreProfileController {
  constructor(private readonly profile: StoreProfileService) {}

  @Get()
  @ApiOperation({ summary: 'This store’s profile' })
  get(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<StoreProfileView> {
    return this.profile.get(user.storeId);
  }

  @Patch()
  @RequireStorePermissions('store.profile.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change the display name, contact email or phone' })
  update(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: UpdateStoreProfileDto,
  ): Promise<StoreProfileView> {
    return this.profile.update(user, body);
  }

  @Post('logo/presign')
  @RequireStorePermissions('store.profile.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'A presigned PUT for the logo; then POST /logo/register' })
  presignLogo(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: PresignStoreLogoDto,
  ): Promise<StoreLogoPresign> {
    return this.profile.presignLogo(user.storeId, body.mimeType);
  }

  @Post('logo/register')
  @RequireStorePermissions('store.profile.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register an uploaded logo (after the presigned PUT succeeded)' })
  registerLogo(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: RegisterStoreLogoDto,
  ): Promise<StoreProfileView> {
    return this.profile.registerLogo(user, body.storageKey, body.mimeType);
  }

  @Delete('logo')
  @RequireStorePermissions('store.profile.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove the logo' })
  removeLogo(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<StoreProfileView> {
    return this.profile.removeLogo(user);
  }
}
