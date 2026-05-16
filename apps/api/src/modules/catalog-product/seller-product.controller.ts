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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsQueryDto } from './dto/list-products.dto';
import { CatalogProductService, type ProductView } from './services/catalog-product.service';

@ApiTags('seller-products')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@Controller('seller/products')
export class SellerProductController {
  constructor(private readonly svc: CatalogProductService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a product (APPROVED sellers only)' })
  create(
    @Body() body: CreateProductDto,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<ProductView> {
    return this.svc.create(seller.id, body, ctx);
  }

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "List the seller's products" })
  list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query() query: ListProductsQueryDto,
  ): Promise<{ items: ProductView[]; total: number; page: number; pageSize: number }> {
    return this.svc.list(seller.id, query);
  }

  @Get(':id')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get one of the seller’s products' })
  getById(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<ProductView> {
    return this.svc.getById(seller.id, id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a product (APPROVED only)' })
  update(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: UpdateProductDto,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<ProductView> {
    return this.svc.update(seller.id, id, body, ctx);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a product (cascades ARCHIVED to its variants)' })
  archive(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<ProductView> {
    return this.svc.archive(seller.id, id, ctx);
  }

  @Post(':id/unarchive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unarchive a product (does NOT re-activate variants)' })
  unarchive(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<ProductView> {
    return this.svc.unarchive(seller.id, id, ctx);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a product (cascades soft-delete to its variants)' })
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    await this.svc.softDelete(seller.id, id, ctx);
  }
}
