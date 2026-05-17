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
import { ActorType, OrderStatus } from '@skydrop/db';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { AdminCancelOrderDto, AdminListOrdersQueryDto } from '../dto/admin-order.dto';
import {
  OrderService,
  type OrderListItem,
  type OrderView,
} from '../services/order.service';
import {
  OrderWriteService,
  type TransitionStatusResult,
} from '../services/order-write.service';

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
}
