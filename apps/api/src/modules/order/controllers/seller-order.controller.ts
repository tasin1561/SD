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
import { ActorType } from '@skydrop/db';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { SellerAuthAllowSuspended } from '../../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { CreateOrderDto } from '../dto/create-order.dto';
import { UpdateOrderDto } from '../dto/update-order.dto';
import { CancelOrderDto } from '../dto/cancel-order.dto';
import { ListOrdersQueryDto } from '../dto/list-orders-query.dto';
import {
  OrderService,
  type OrderEventView,
  type OrderListItem,
  type OrderView,
} from '../services/order.service';
import { SellerUserRole } from '@skydrop/db';
import { SellerRoles } from '../../../common/decorators/seller-roles.decorator';
import { SellerViewerReadable } from '../../../common/decorators/seller-viewer-readable.decorator';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

@ApiTags('seller-orders')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@SellerRoles(SellerUserRole.OWNER, SellerUserRole.ADMIN, SellerUserRole.OPS)
// The orders surface is the ONE area a VIEWER may read: the list, an
// order's detail, and its event timeline — which is what the tracking
// view is built from. Writes here remain OWNER / ADMIN / OPS.
@SellerViewerReadable()
@Controller('seller/orders')
export class SellerOrderController {
  constructor(private readonly svc: OrderService) {}

  private actor(seller: AuthenticatedSeller): { type: ActorType; id: string } {
    return { type: ActorType.SELLER, id: seller.id };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a manual order (DRAFT)' })
  create(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: CreateOrderDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<OrderView> {
    return this.svc.create(seller.id, body, this.actor(seller), ctx);
  }

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "List the seller's orders" })
  list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query() query: ListOrdersQueryDto,
  ): Promise<{ items: OrderListItem[]; total: number; page: number; pageSize: number }> {
    return this.svc.list(seller.id, query);
  }

  @Get(':id')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get one order (with items)' })
  get(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
  ): Promise<OrderView> {
    return this.svc.loadOwned(seller.id, id);
  }

  @Get(':id/events')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Seller-visible order timeline' })
  events(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
  ): Promise<OrderEventView[]> {
    return this.svc.listEvents(seller.id, id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Edit an order (DRAFT full / PENDING_CONFIRMATION corrections)' })
  edit(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
    @Body() body: UpdateOrderDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<OrderView> {
    return this.svc.edit(seller.id, id, body, this.actor(seller), ctx);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit a DRAFT order for call confirmation' })
  submit(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<OrderView> {
    return this.svc.submit(seller.id, id, this.actor(seller), ctx);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a pre-reservation order' })
  cancel(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
    @Body() body: CancelOrderDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<OrderView> {
    return this.svc.cancel(seller.id, id, body, this.actor(seller), ctx);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Discard (soft-delete) a DRAFT order' })
  async discard(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    await this.svc.discardDraft(seller.id, id, this.actor(seller), ctx);
  }
}
