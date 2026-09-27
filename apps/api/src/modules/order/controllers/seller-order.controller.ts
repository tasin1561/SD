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
import { OrderReadService } from '../services/order-read.service';
import { OrderWriteService } from '../services/order-write.service';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

@ApiTags('seller-orders')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
// `orders.view` opens the reads on this controller: the list, an order's
// detail, and its event timeline — which is what the tracking view is
// built from. Every WRITE declares its own key at the handler, and so
// does `customer-lookup`, which is a platform-wide lookup rather than a
// view of this seller's own orders.
@RequireSellerPermissions('orders.view')
@Controller('seller/orders')
export class SellerOrderController {
  constructor(
    private readonly svc: OrderService,
    private readonly orderWrite: OrderWriteService,
    private readonly reputation: CustomerReputationService,
    private readonly reads: OrderReadService,
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
  // a literal segment placed after the parameter would be swallowed by
  // it and read as an order id.
  @Get('summary')
  @SellerAuthAllowSuspended()
  @ApiOperation({
    summary:
      'How many orders sit at each status and how much COD is on them — one query, so the chip counts and the tiles cannot disagree with each other.',
  })
  summary(
    @CurrentSeller() seller: AuthenticatedSeller,
  ): ReturnType<OrderReadService['statusSummary']> {
    return this.reads.statusSummary(seller.id);
  }

  // MUST stay above @Get(':id') for the same reason as customer-lookup
  // below: a parameterised route declared first swallows this path as
  // an order id and 400s on the UUID pipe.
  @Get('money-in-flight')
  @SellerAuthAllowSuspended()
  @ApiOperation({
    summary:
      'What is still coming: COD on orders confirmed but not delivered, and COD on orders ' +
      'delivered but not yet credited. Gross figures — our fees and the withheld GST are ' +
      'still inside them.',
  })
  moneyInFlight(@CurrentSeller() seller: AuthenticatedSeller): Promise<{
    inTransit: { count: number; codInr: string };
    processing: { count: number; codInr: string };
  }> {
    return this.reads.moneyInFlight(seller.id);
  }

  // MUST stay above @Get(':id') — Nest matches in declaration order, so
  // a parameterised route declared first would swallow this path as an
  // order id and 400 on the UUID pipe.
  @Get('customer-lookup')
  // The ONE GET on this controller that `orders.view` does NOT open, and
  // the gate is the ONLY thing standing between a read-only login and
  // platform-wide customer intelligence: the counts inside span EVERY
  // seller, so this answers "who else has this person ordered from, and
  // did it go wrong" for an arbitrary phone number. It is a lookup TOOL,
  // not a view of the caller's own data, and nobody decided it should be
  // readable by the narrowest role there is — it inherited that by being
  // a GET on the orders controller.
  //
  // `orders.create` is the gate because it reproduces the surface this
  // endpoint has always been meant to have — owner / admin / ops, and no
  // other seeded role — and because it names the act the lookup is FOR:
  // deciding whether to accept an order before you ship it. A dedicated
  // key would have reached no role that already exists, so every ops
  // login in production would have seen the field and then been refused.
  //
  // Deliberately NOT @SellerAuthAllowSuspended: a suspended seller may
  // still read their own history (that is a record), but a platform-wide
  // lookup is a live service and stops with the account.
  @RequireSellerPermissions('orders.create')
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
    // the write boundary returns a transition result, not a view — the
    // SELLER's view, which reads a reseller store's order in full (ORD-7
    // amended 2026-09-16).
    return this.svc.loadOwnedForSeller(seller.id, id);
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
