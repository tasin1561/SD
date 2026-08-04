import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { ListSellerStockQueryDto } from './dto/list-seller-stock.dto';
import {
  SellerStockService,
  type AggregatedStockList,
  type AggregatedStockSummary,
  type AggregatedVariantStock,
} from './services/seller-stock.service';
import { RequireSellerPermissions } from '../../common/auth/require-seller-permissions.decorator';

/**
 * Seller stock visibility. Read-only — allowed for SUSPENDED sellers
 * (consistent with catalog list/get): a suspended seller may inspect
 * their inventory, just not mutate. Numbers are aggregated across all
 * warehouses (locked decision #6) and served from the display cache.
 */
@ApiTags('seller-stock')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('inventory.view')
@Controller('seller/stock')
export class SellerStockController {
  constructor(private readonly svc: SellerStockService) {}

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Paginated stock across all warehouses (filter by status)' })
  list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query() query: ListSellerStockQueryDto,
  ): Promise<AggregatedStockList> {
    return this.svc.list(seller.id, query);
  }

  @Get('summary')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Roll-up totals across all warehouses' })
  summary(@CurrentSeller() seller: AuthenticatedSeller): Promise<AggregatedStockSummary> {
    return this.svc.summary(seller.id);
  }

  @Get('by-variant/:variantId')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aggregated stock for one variant across all warehouses' })
  byVariant(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('variantId', new ParseUUIDPipe({ version: '7' })) variantId: string,
  ): Promise<AggregatedVariantStock> {
    return this.svc.byVariant(seller.id, variantId);
  }
}
