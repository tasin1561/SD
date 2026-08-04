import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { ListSellerMovementsQueryDto } from './dto/list-movements.dto';
import {
  InventoryMovementService,
  type MovementListResult,
} from './services/inventory-movement.service';
import { RequireSellerPermissions } from '../../common/auth/require-seller-permissions.decorator';

/**
 * Seller's own stock-movement ledger (read-only; allowed for SUSPENDED
 * sellers). No cache — the ledger is a time-series source of truth, always
 * read live.
 */
@ApiTags('seller-stock')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('inventory.view')
@Controller('seller/stock')
export class SellerMovementController {
  constructor(private readonly svc: InventoryMovementService) {}

  @Get('movements')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Paginated, filterable stock-movement ledger for the seller' })
  list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query() query: ListSellerMovementsQueryDto,
  ): Promise<MovementListResult> {
    return this.svc.listForSeller(seller.id, query);
  }
}
