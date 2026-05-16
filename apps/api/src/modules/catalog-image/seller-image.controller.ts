import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { PresignImageDto } from './dto/presign-image.dto';
import { RegisterImageDto } from './dto/register-image.dto';
import {
  CatalogImageService,
  type ImageView,
  type PresignResult,
} from './services/catalog-image.service';

@ApiTags('seller-variant-images')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@Controller('seller/variants/:variantId/images')
export class SellerImageController {
  constructor(private readonly svc: CatalogImageService) {}

  @Post('presign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get a presigned PUT URL for a variant image (15-min TTL)',
  })
  presign(
    @Param('variantId', new ParseUUIDPipe({ version: '7' })) variantId: string,
    @Body() body: PresignImageDto,
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<PresignResult> {
    return this.svc.presignUpload(seller.id, variantId, body);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register an uploaded image (HEAD-verified) + queue thumbnail',
  })
  register(
    @Param('variantId', new ParseUUIDPipe({ version: '7' })) variantId: string,
    @Body() body: RegisterImageDto,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<ImageView> {
    return this.svc.register(seller.id, variantId, body, ctx);
  }

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List a variant’s images' })
  list(
    @Param('variantId', new ParseUUIDPipe({ version: '7' })) variantId: string,
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<ImageView[]> {
    return this.svc.listForVariant(seller.id, variantId);
  }

  @Delete(':imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Soft-delete an image; queues deletion of the original + thumbnail',
  })
  async remove(
    @Param('variantId', new ParseUUIDPipe({ version: '7' })) variantId: string,
    @Param('imageId', new ParseUUIDPipe({ version: '7' })) imageId: string,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    await this.svc.delete(seller.id, variantId, imageId, ctx);
  }
}
