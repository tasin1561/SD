import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerAuthAllowSuspended } from '../../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { ListInboundFreightQueryDto } from '../dto/inbound-freight.dto';
import {
  InboundFreightService,
  type FreightChargeView,
} from '../services/inbound-freight.service';

/**
 * R3 seller surface — read-only. A seller can see what their inbound
 * freight cost and what they still owe; only ops records or settles a
 * bill. Readable while SUSPENDED on purpose: a suspended seller still
 * needs to see (and be able to reason about) an outstanding balance.
 */
@ApiTags('seller-inbound-freight')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@Controller('seller/inbound-freight')
export class SellerInboundFreightController {
  constructor(private readonly svc: InboundFreightService) {}

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'This seller\'s inbound freight bills (BD→India), newest first' })
  async list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query() query: ListInboundFreightQueryDto,
  ): Promise<{ items: readonly FreightChargeView[]; outstandingInr: string }> {
    const [items, outstandingInr] = await Promise.all([
      this.svc.listForSeller(
        seller.id,
        query.status === undefined ? undefined : query.status,
      ),
      this.svc.outstandingForSeller(seller.id),
    ]);
    return { items, outstandingInr };
  }
}
