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
import { Throttle } from '@nestjs/throttler';
import { minutes } from '../../../common/throttler/throttler.module';
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
import { CustomerLookupQueryDto } from '../dto/customer-lookup.dto';
import {
  CustomerReputationService,
  type CustomerReputation,
} from '../services/customer-reputation.service';
import {
  OrderService,
  type OrderEventView,
  type OrderListItem,
  type OrderView,
} from '../services/order.service';
import { OrderWriteService } from '../services/order-write.service';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

@ApiTags('seller-orders')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
// The orders surface is the ONE area a VIEWER may read: the list, an
// order's detail, and its event timeline — which is what the tracking
// view is built from. Writes here remain OWNER / ADMIN / OPS.
@RequireSellerPermissions('orders.view')
@Controller('seller/orders')
export class SellerOrderController {
  constructor(
    private readonly svc: OrderService,
    private readonly orderWrite: OrderWriteService,
    private readonly reputation: CustomerReputationService,
  ) {}

  private actor(seller: AuthenticatedSeller): { type: ActorType; id: string } {
    return { type: ActorType.SELLER, id: seller.id };
  }

  @Post()
  @RequireSellerPermissions('orders.create')
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

  // MUST stay above @Get(':id') — Nest matches in declaration order, so
  // a parameterised route declared first would swallow this path as an
  // order id and 400 on the UUID pipe.
  @Get('customer-lookup')
  @SellerAuthAllowSuspended()
  // The ONE GET on this controller a VIEWER may not make. The class
  // carries @SellerViewerReadable() so a VIEWER can read orders, and
  // this endpoint inherited that by being a GET on the same controller
  // — which nobody decided. It is not an order they already have: it
  // takes an arbitrary phone number and answers questions about it,
  // which is a lookup TOOL rather than a view of their own data.
  // Handler-level @SellerRoles wins over the class opt-in (rule 1).
  // Tighter than the 100/min baseline. Entering an order is one lookup;
  // even a fast operator does a handful a minute. The platform-wide
  // counts are a deliberate disclosure, but disclosing them one number
  // at a time to someone placing orders is a different act from letting
  // a script walk a list of numbers and harvest who shops where.
  @Throttle({ default: { limit: 30, ttl: minutes(1) } })
  @ApiOperation({
    summary:
      'What we know about a phone number before you ship to it: platform-wide counts, your own orders, and anything of yours not yet packed',
  })
  customerLookup(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query() query: CustomerLookupQueryDto,
  ): Promise<CustomerReputation> {
    // Counts span every seller — refusal risk belongs to the customer,
    // not to the seller-customer pair. The ORDER LIST inside is filtered
    // to this seller's own, so nobody learns who else sells to them.
    return this.reputation.lookup(seller.id, query.phoneE164.trim());
  }

  @Get(':id')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get one order (with items)' })
  get(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
  ): Promise<OrderView> {
    return this.svc.loadOwnedForDisplay(seller.id, id);
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
  @RequireSellerPermissions('orders.create')
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
  @RequireSellerPermissions('orders.create')
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
  @RequireSellerPermissions('orders.cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel an order — allowed until it is packed. Refunds a delivery fee already taken.',
  })
  async cancel(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
    @Body() body: CancelOrderDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<OrderView> {
    await this.orderWrite.cancelBySeller({
      sellerId: seller.id,
      orderId: id,
      actor: this.actor(seller),
      ...(body.reason !== undefined ? { cancellationReason: body.reason } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ctx,
    });
    // Re-read so the seller gets the full order back, same as before —
    // the write boundary returns a transition result, not a view.
    return this.svc.loadOwned(seller.id, id);
  }

  @Delete(':id')
  @RequireSellerPermissions('orders.create')
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
