import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorType, OrderStatus } from '@skydrop/db';
import {
  CustomerReputationService,
  type CustomerReputation,
} from '../services/customer-reputation.service';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import {
  AdminCancelOrderDto,
  AdminListOrdersQueryDto,
  ReleaseReservationsDto,
} from '../dto/admin-order.dto';
import { ForceMutationDto } from '../dto/force-mutation.dto';
import {
  OrderService,
  type OrderEventView,
  type OrderListItem,
  type OrderView,
} from '../services/order.service';
import { OrderWriteService, type TransitionStatusResult } from '../services/order-write.service';
import {
  OrderAdminOverrideService,
  type ForceMutateResult,
  type ReleaseReservationsResult,
} from '../services/order-admin-override.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * Admin order ops (Checkpoint 2 scope): cross-seller list + detail +
 * SANE cancel. Sane cancel = CANCELLED_BY_ADMIN driven through
 * OrderWriteService.transitionStatus (state-machine guarded; reserved
 * orders release stock via the saga). God mode (ORD-2 forceMutate /
 * hasAdminOverride) is deliberately NOT here. Staff JWT on every route;
 * RBAC scoping defers to Module 12 (phase-1a-debt, same as every other
 * Phase 1A admin surface).
 */
@ApiTags('admin-orders')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/orders')
export class AdminOrderController {
  constructor(
    private readonly orders: OrderService,
    private readonly orderWrite: OrderWriteService,
    private readonly override: OrderAdminOverrideService,
    private readonly reputation: CustomerReputationService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List orders across sellers (filter by seller/status/source/search)' })
  list(
    @Query() query: AdminListOrdersQueryDto,
  ): Promise<{ items: OrderListItem[]; total: number; page: number; pageSize: number }> {
    return this.orders.adminList(query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get one order (with items)' })
  get(@Param('id', uuid()) id: string): Promise<OrderView> {
    return this.orders.adminGetById(id);
  }

  @Get(':id/events')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin order timeline — every event (incl. internal-only), oldest first',
  })
  events(@Param('id', uuid()) id: string): Promise<OrderEventView[]> {
    return this.orders.listEventsForAdmin(id);
  }

  @Get(':id/customer-reputation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "What we know about this order's customer — platform-wide counts plus the seller's own history. For the agent about to phone them.",
  })
  async customerReputation(@Param('id', uuid()) id: string): Promise<CustomerReputation> {
    const res = await this.reputation.lookupForOrder(id);
    if (res === null) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
    }
    return res;
  }

  @Get(':id/shipments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Shipments associated with an order — newest first, includes superseded entries',
  })
  shipments(@Param('id', uuid()) id: string): ReturnType<OrderService['listShipmentsForAdmin']> {
    return this.orders.listShipmentsForAdmin(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sane admin cancel → CANCELLED_BY_ADMIN (NOT god mode)' })
  cancel(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', uuid()) id: string,
    @Body() body: AdminCancelOrderDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<TransitionStatusResult> {
    return this.orderWrite.transitionStatus({
      orderId: id,
      to: OrderStatus.CANCELLED_BY_ADMIN,
      actor: { type: ActorType.STAFF, id: staff.id },
      ...(body.cancellationReason !== undefined
        ? { cancellationReason: body.cancellationReason }
        : {}),
      reason: body.note ?? 'Admin cancellation',
      ctx,
    });
  }

  @Post(':id/force-mutation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'GOD MODE (ORD-2): bypass the state machine / edit rules. Audited CRITICAL.',
  })
  forceMutation(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', uuid()) id: string,
    @Body() body: ForceMutationDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<ForceMutateResult> {
    return this.override.forceMutate({
      orderId: id,
      ...(body.fieldChanges !== undefined ? { fieldChanges: body.fieldChanges } : {}),
      ...(body.targetStatus !== undefined ? { targetStatus: body.targetStatus } : {}),
      reason: body.reason,
      acknowledgeDataIntegrityRisk: body.acknowledgeDataIntegrityRisk,
      actorStaffId: staff.id,
      ctx,
    });
  }

  @Post(':id/release-reservations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Manually release an order's ACTIVE reservations (god-mode cleanup; idempotent)",
  })
  releaseReservations(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', uuid()) id: string,
    @Body() body: ReleaseReservationsDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<ReleaseReservationsResult> {
    return this.override.releaseReservations({
      orderId: id,
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
      actorStaffId: staff.id,
      ctx,
    });
  }
}
