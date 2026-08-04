import {
  Body,
  Controller,
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
import {
  DeclareGoodsReceiptDto,
  ListGoodsReceiptsQueryDto,
  UpdateGoodsReceiptDto,
} from './dto/goods-receipt.dto';
import { GoodsReceiptService, type GoodsReceiptView } from './services/goods-receipt.service';
import { RequireSellerPermissions } from '../../common/auth/require-seller-permissions.decorator';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

@ApiTags('seller-goods-receipts')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('inbound.view')
@Controller('seller/goods-receipts')
export class SellerGoodsReceiptController {
  constructor(private readonly svc: GoodsReceiptService) {}

  @Post()
  @RequireSellerPermissions('inbound.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Declare an incoming goods receipt (APPROVED sellers only)' })
  declare(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: DeclareGoodsReceiptDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<GoodsReceiptView> {
    return this.svc.declare(seller.id, body, ctx);
  }

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "List the seller's goods receipts" })
  list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query() query: ListGoodsReceiptsQueryDto,
  ): Promise<{ items: GoodsReceiptView[]; total: number; page: number; pageSize: number }> {
    return this.svc.list(seller.id, query);
  }

  @Get(':id')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get one goods receipt' })
  get(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
  ): Promise<GoodsReceiptView> {
    return this.svc.getForSeller(seller.id, id);
  }

  @Patch(':id')
  @RequireSellerPermissions('inbound.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Edit a PENDING goods receipt' })
  update(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
    @Body() body: UpdateGoodsReceiptDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<GoodsReceiptView> {
    return this.svc.update(seller.id, id, body, ctx);
  }

  @Post(':id/cancel')
  @RequireSellerPermissions('inbound.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a PENDING goods receipt' })
  cancel(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<GoodsReceiptView> {
    return this.svc.cancel(seller.id, id, ctx);
  }
}
