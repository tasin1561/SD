import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import {
  AttributeResolutionService,
  type EffectiveAttribute,
} from './services/attribute-resolution.service';

/**
 * Seller-facing effective attribute lookup. Sellers need the resolved
 * (inherited + own) attribute schema for a category to know which
 * attributes a variant under it must/can carry. Read-only; categories are
 * global so no seller scoping. Allows SUSPENDED (read-only browse).
 */
@ApiTags('seller-category-attributes')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@Controller('seller/categories/:categoryId/attributes')
export class SellerAttributeController {
  constructor(private readonly resolution: AttributeResolutionService) {}

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Effective (inherited + own) attribute set for a category',
  })
  effective(
    @Param('categoryId', new ParseUUIDPipe({ version: '7' })) categoryId: string,
  ): Promise<EffectiveAttribute[]> {
    return this.resolution.resolveEffectiveAttributes(categoryId);
  }
}
