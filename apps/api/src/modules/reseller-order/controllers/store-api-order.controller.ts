import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrderSource } from '@skydrop/db';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { CurrentStoreApiKey } from '../../../common/decorators/current-store-api-key.decorator';
import { StoreApiKeyGuard } from '../../../common/guards/store-api-key.guard';
import type { AuthenticatedStoreApiKey } from '../../../common/types/request';
import { CreateStoreOrderDto } from '../../order/dto/create-store-order.dto';
import { ResellerOrderService } from '../../order/services/reseller-order.service';
import { StoreOrderListQueryDto } from '../dto/store-order-query.dto';
import {
  StoreOrdersService,
  type StoreOrderListItem,
  type StoreOrderView,
} from '../services/store-orders.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * RS-5 — a reseller store's integration, by API key
 * (`Authorization: Bearer sks_…`). The same order path as the portal:
 * every refusal `ResellerOrderService` makes applies, and the key reaches
 * its OWN store's orders only. A key is a machine, so it may place and
 * read orders and nothing else — it cannot cancel, manage keys, or see
 * the store's customer list.
 */
@ApiTags('store-api')
@ApiBearerAuth('store-api-key')
@UseGuards(StoreApiKeyGuard)
@Controller('store-api/v1/orders')
export class StoreApiOrderController {
  constructor(
    private readonly orders: StoreOrdersService,
    private readonly placing: ResellerOrderService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Place an order for this store (goes to call confirmation)' })
  async create(
    @CurrentStoreApiKey() key: AuthenticatedStoreApiKey,
    @Body() body: CreateStoreOrderDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<StoreOrderView> {
    const created = await this.placing.create(
      { kind: 'STORE_API_KEY', storeId: key.storeId, apiKeyId: key.id },
      body,
      ctx,
      { source: OrderSource.API },
    );
    return this.orders.detail(key.storeId, created.id);
  }

  @Get()
  @ApiOperation({ summary: 'This store’s orders' })
  list(
    @CurrentStoreApiKey() key: AuthenticatedStoreApiKey,
    @Query() query: StoreOrderListQueryDto,
  ): Promise<{ items: StoreOrderListItem[]; total: number; page: number; pageSize: number }> {
    return this.orders.list(key.storeId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of this store’s orders' })
  get(
    @CurrentStoreApiKey() key: AuthenticatedStoreApiKey,
    @Param('id', uuid()) id: string,
  ): Promise<StoreOrderView> {
    return this.orders.detail(key.storeId, id);
  }
}
