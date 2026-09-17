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
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { CancelOrderDto } from '../../order/dto/cancel-order.dto';
import { CreateStoreOrderDto } from '../../order/dto/create-store-order.dto';
import { ResellerOrderService } from '../../order/services/reseller-order.service';
import { StoreOrderListQueryDto } from '../dto/store-order-query.dto';
import {
  StoreOrdersService,
  type StoreCancelOutcome,
  type StoreOrderEventView,
  type StoreOrderListItem,
  type StoreOrderView,
} from '../services/store-orders.service';
import type { StoreOrderRequestView } from '../../store-order-request/services/store-order-request.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * RS-5 — a reseller store's OWN orders on its portal. The store is the
 * caller's token's, never a parameter; an order of another store (or of
 * the seller's own) is a 404.
 */
@ApiTags('store-orders')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('orders.view')
@Controller('store/orders')
export class StoreOrderController {
  constructor(
    private readonly orders: StoreOrdersService,
    private readonly placing: ResellerOrderService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'This store’s orders, newest first' })
  list(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Query() query: StoreOrderListQueryDto,
  ): Promise<{ items: StoreOrderListItem[]; total: number; page: number; pageSize: number }> {
    return this.orders.list(user.storeId, query);
  }

  @Post()
  @RequireStorePermissions('orders.create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Place an order from this store’s catalogue. It goes straight to call confirmation; nothing is reserved until then.',
  })
  async create(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: CreateStoreOrderDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<StoreOrderView> {
    const created = await this.placing.create(
      { kind: 'STORE_USER', storeId: user.storeId, storeUserId: user.id },
      body,
      ctx,
      { source: OrderSource.MANUAL },
    );
    return this.orders.detail(user.storeId, created.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of this store’s orders' })
  get(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', uuid()) id: string,
  ): Promise<StoreOrderView> {
    return this.orders.detail(user.storeId, id);
  }

  @Get(':id/events')
  @ApiOperation({ summary: 'The order’s timeline' })
  events(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', uuid()) id: string,
  ): Promise<StoreOrderEventView[]> {
    return this.orders.events(user.storeId, id);
  }

  @Post(':id/cancel')
  @RequireStorePermissions('orders.cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cancel one of this store’s orders — until it is packed. Cancels now, or waits for seller staff, per the seller’s policy.',
  })
  cancel(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', uuid()) id: string,
    @Body() body: CancelOrderDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<StoreCancelOutcome> {
    return this.orders.cancel(user, id, body, ctx);
  }

  @Get(':id/requests')
  @ApiOperation({
    summary:
      'What this store has sent seller staff to approve on the order (cancel, call-cap answer, issue with Skydrop), and what became of it',
  })
  requests(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', uuid()) id: string,
  ): Promise<readonly StoreOrderRequestView[]> {
    return this.orders.heldRequests(user.storeId, id);
  }
}
