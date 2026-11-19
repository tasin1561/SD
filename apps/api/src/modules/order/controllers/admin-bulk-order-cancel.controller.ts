import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorType, OrderStatus } from '@skydrop/db';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { BulkCancelDto } from '../../../common/bulk/bulk-action.dto';
import { BulkRunnerService, type BulkResult } from '../../../common/bulk/bulk-runner.service';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { OrderWriteService } from '../services/order-write.service';

@ApiTags('admin-orders')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('orders.view')
@Controller('admin/bulk/orders')
export class AdminBulkOrderCancelController {
  constructor(
    private readonly orderWrite: OrderWriteService,
    private readonly bulk: BulkRunnerService,
  ) {}

  @Post('cancel')
  @RequirePermissions('orders.cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Sane admin cancel (→ CANCELLED_BY_ADMIN, NOT god mode) for up to 200 orders — each through the same transition the single admin cancel uses.',
  })
  cancel(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() body: BulkCancelDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<BulkResult> {
    return this.bulk.run(
      {
        actor: { type: 'STAFF', id: staff.id },
        action: 'admin.cancel',
        idempotencyKey: body.idempotencyKey,
        ids: body.orderIds,
        params: { reason: body.reason ?? null, note: body.note ?? null },
      },
      async (orderId) => {
        await this.orderWrite.transitionStatus({
          orderId,
          to: OrderStatus.CANCELLED_BY_ADMIN,
          actor: { type: ActorType.STAFF, id: staff.id },
          ...(body.reason !== undefined ? { cancellationReason: body.reason } : {}),
          reason: body.note ?? 'Admin cancellation (bulk)',
          ctx,
        });
      },
    );
  }
}
