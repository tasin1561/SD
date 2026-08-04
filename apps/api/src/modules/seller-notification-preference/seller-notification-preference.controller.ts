import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SellerNotificationCategory } from '@skydrop/db';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { UpdateNotificationPreferenceDto } from './dto/update-preference.dto';
import {
  SellerNotificationPreferenceService,
  type NotificationPreferenceView,
} from './services/seller-notification-preference.service';
import { RequireSellerPermissions } from '../../common/auth/require-seller-permissions.decorator';

@ApiTags('seller-notification-preferences')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('notifications.manage')
@Controller('seller/notification-preferences')
export class SellerNotificationPreferenceController {
  constructor(private readonly svc: SellerNotificationPreferenceService) {}

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List the 7 notification-category preferences for the current seller' })
  list(@CurrentSeller() seller: AuthenticatedSeller): Promise<NotificationPreferenceView[]> {
    return this.svc.list(seller.id);
  }

  @Patch(':category')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Partial update of one preference row (APPROVED only)' })
  update(
    @Param('category', new ParseEnumPipe(SellerNotificationCategory))
    category: SellerNotificationCategory,
    @Body() body: UpdateNotificationPreferenceDto,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<NotificationPreferenceView> {
    return this.svc.update(seller.id, category, body, ctx);
  }
}
