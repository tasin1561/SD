import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { CatalogVariantService, type VariantView } from './services/catalog-variant.service';
import { RequireSellerPermissions } from '../../common/auth/require-seller-permissions.decorator';

@ApiTags('seller-variants')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('catalog.view')
@Controller('seller/products/:productId/variants')
export class SellerVariantController {
  constructor(private readonly svc: CatalogVariantService) {}

  @Post()
  @RequireSellerPermissions('catalog.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a variant',
    description:
      'On attribute failure returns 400 ATTRIBUTE_VALIDATION_FAILED with an ' +
      '`errors` array listing every problem so the seller can fix in one pass.',
  })
  create(
    @Param('productId', new ParseUUIDPipe({ version: '7' })) productId: string,
    @Body() body: CreateVariantDto,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<VariantView> {
    return this.svc.create(seller.id, productId, body, ctx);
  }

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List a product’s variants' })
  list(
    @Param('productId', new ParseUUIDPipe({ version: '7' })) productId: string,
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<VariantView[]> {
    return this.svc.listForProduct(seller.id, productId);
  }

  @Get(':variantId')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single variant' })
  getById(
    @Param('productId', new ParseUUIDPipe({ version: '7' })) productId: string,
    @Param('variantId', new ParseUUIDPipe({ version: '7' })) variantId: string,
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<VariantView> {
    return this.svc.getById(seller.id, productId, variantId);
  }

  @Patch(':variantId')
  @RequireSellerPermissions('catalog.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a variant (re-validates attributes if provided)' })
  update(
    @Param('productId', new ParseUUIDPipe({ version: '7' })) productId: string,
    @Param('variantId', new ParseUUIDPipe({ version: '7' })) variantId: string,
    @Body() body: UpdateVariantDto,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<VariantView> {
    return this.svc.update(seller.id, productId, variantId, body, ctx);
  }

  @Post(':variantId/archive')
  @RequireSellerPermissions('catalog.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a variant' })
  archive(
    @Param('productId', new ParseUUIDPipe({ version: '7' })) productId: string,
    @Param('variantId', new ParseUUIDPipe({ version: '7' })) variantId: string,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<VariantView> {
    return this.svc.archive(seller.id, productId, variantId, ctx);
  }

  @Post(':variantId/unarchive')
  @RequireSellerPermissions('catalog.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unarchive a variant' })
  unarchive(
    @Param('productId', new ParseUUIDPipe({ version: '7' })) productId: string,
    @Param('variantId', new ParseUUIDPipe({ version: '7' })) variantId: string,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<VariantView> {
    return this.svc.unarchive(seller.id, productId, variantId, ctx);
  }

  @Delete(':variantId')
  @RequireSellerPermissions('catalog.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a variant' })
  async remove(
    @Param('productId', new ParseUUIDPipe({ version: '7' })) productId: string,
    @Param('variantId', new ParseUUIDPipe({ version: '7' })) variantId: string,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    await this.svc.softDelete(seller.id, productId, variantId, ctx);
  }
}
